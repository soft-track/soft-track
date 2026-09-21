"""Full-text search over issue titles, descriptions and comments.

Two implementations behind one function, chosen by the dialect at runtime:

* **Postgres** uses `to_tsvector` / `plainto_tsquery` ranked by `ts_rank`,
  backed by GIN indexes. That is the deployment target, and the one that stays
  fast and handles stemming -- "deploying" finds "deploy".
* **SQLite** falls back to case-insensitive LIKE. It is the local-development
  default, it has no stemming, and it will degrade on a large dataset. Saying
  that plainly beats pretending one code path serves both equally.

Two properties hold either way. Tenancy is filtered *in the query*, never as a
post-filter, so a bug in ranking or pagination can never widen the scope. And
the cost is a fixed number of queries per page -- count, page, comments --
rather than one per result.
"""

from typing import Optional

from sqlalchemy import (
    Float,
    String,
    cast,
    func,
    literal_column,
    or_,
    select as sa_select,
)
from sqlmodel import Session, select

from lib_softtrack.models.page import DEFAULT_LIMIT, Page
from lib_softtrack.models.search import SearchHit
from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.tables import (
    Comment,
    Issue,
    Team,
    TeamMember,
    User,
    WorkflowStatus,
)

#: Characters of context to show either side of a match.
SNIPPET_RADIUS = 90


def search_issues(
    session: Session,
    current_user: User,
    query: str,
    team_id: Optional[int] = None,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> Page[SearchHit]:
    query = query.strip()
    if not query:
        return Page(items=[], total=0, limit=limit, offset=offset)

    team_ids = list(
        session.exec(
            select(TeamMember.team_id).where(TeamMember.user_id == current_user.id)
        ).all()
    )
    if team_id is not None:
        # Narrowing to one team can only remove teams from the visible set,
        # never add one.
        team_ids = [tid for tid in team_ids if tid == team_id]
    if not team_ids:
        return Page(items=[], total=0, limit=limit, offset=offset)

    postgres = session.get_bind().dialect.name == "postgresql"
    condition, order_by = (
        _postgres_query(query, team_ids) if postgres else _like_query(query, team_ids)
    )

    total = session.exec(select(func.count()).select_from(Issue).where(condition)).one()

    issues = list(
        session.exec(
            select(Issue)
            .where(condition)
            .order_by(*order_by)
            .offset(offset)
            .limit(limit)
        ).all()
    )
    if not issues:
        return Page(items=[], total=total, limit=limit, offset=offset)

    # One query for every matching comment on the page, rather than one per
    # result. Ordered so the first row per issue is the earliest match.
    comment_by_issue: dict[int, str] = {}
    for comment in session.exec(
        select(Comment)
        .where(
            Comment.issue_id.in_([issue.id for issue in issues]),
            cast(Comment.body, String).ilike(f"%{query}%"),
        )
        .order_by(Comment.created_at)
    ).all():
        comment_by_issue.setdefault(comment.issue_id, comment.body)

    teams = {
        team.id: team
        for team in session.exec(
            select(Team).where(Team.id.in_({issue.team_id for issue in issues}))
        ).all()
    }
    # Search reaches across every team the caller is in, so a page of hits can
    # carry statuses from several different workflows.
    statuses = {
        status.id: status
        for status in session.exec(
            select(WorkflowStatus).where(
                WorkflowStatus.id.in_({issue.status_id for issue in issues})
            )
        ).all()
    }

    items = []
    for issue in issues:
        matched_in, snippet = _attribute(issue, query, comment_by_issue.get(issue.id))
        items.append(
            SearchHit(
                id=issue.id,
                identifier=f"{teams[issue.team_id].key}-{issue.number}",
                title=issue.title,
                status=StatusRead.model_validate(statuses[issue.status_id]),
                priority=issue.priority,
                team_id=issue.team_id,
                team_key=teams[issue.team_id].key,
                number=issue.number,
                updated_at=issue.updated_at,
                matched_in=matched_in,
                snippet=snippet,
            )
        )

    return Page(items=items, total=total, limit=limit, offset=offset)


#: The text-search configuration, as a SQL literal rather than a bind
#: parameter. Two reasons it must be literal: an expression index is only used
#: when the query expression matches it exactly, and a bound parameter would
#: not; and index expressions must be IMMUTABLE, which `to_tsvector(regconfig,
#: text)` is only in its two-argument form with a constant configuration.
_ENGLISH = literal_column("'english'")


def _document():
    """The searchable text of an issue.

    Concatenated with `||` rather than `concat_ws`, because `concat_ws` is
    STABLE and Postgres refuses to build an index on a non-IMMUTABLE
    expression. This must stay character-identical to the expression in the
    migration that creates the index, or the planner will quietly ignore it
    and fall back to a sequential scan.
    """
    return func.to_tsvector(
        _ENGLISH, Issue.title + " " + func.coalesce(Issue.description, "")
    )


def _postgres_query(query: str, team_ids: list[int]):
    document = _document()
    tsquery = func.plainto_tsquery(_ENGLISH, query)

    comment_matches = sa_select(Comment.issue_id).where(
        func.to_tsvector(_ENGLISH, Comment.body).op("@@")(tsquery)
    )

    condition = (Issue.team_id.in_(team_ids)) & or_(
        document.op("@@")(tsquery),
        Issue.id.in_(comment_matches),
    )
    # Relevance first, recency as the tie-break: two equally relevant issues
    # are not equally interesting, and the fresher one almost always is.
    rank = cast(func.ts_rank(document, tsquery), Float)
    return condition, (rank.desc(), Issue.updated_at.desc())


def _like_query(query: str, team_ids: list[int]):
    pattern = f"%{query}%"
    comment_matches = sa_select(Comment.issue_id).where(
        cast(Comment.body, String).ilike(pattern)
    )

    condition = (Issue.team_id.in_(team_ids)) & or_(
        cast(Issue.title, String).ilike(pattern),
        cast(Issue.description, String).ilike(pattern),
        Issue.id.in_(comment_matches),
    )
    # No ranking function available, so approximate it: a title hit is almost
    # always what someone typing a couple of words is looking for.
    title_first = cast(Issue.title, String).ilike(pattern).desc()
    return condition, (title_first, Issue.updated_at.desc())


def _attribute(
    issue: Issue, query: str, comment_body: Optional[str]
) -> tuple[str, str]:
    """Which field to credit the hit to, and the snippet to show for it.

    Shown next to the result, so a hit whose title does not visibly contain
    the search term does not look like a mistake.
    """
    needle = query.lower()
    if needle in (issue.title or "").lower():
        return "title", _snippet(issue.description, query) or issue.title
    if needle in (issue.description or "").lower():
        return "description", _snippet(issue.description, query)
    if comment_body:
        return "comment", _snippet(comment_body, query)
    # Postgres matched a stem that a plain substring check cannot see (the
    # query "deploying" against the word "deploy"). Credit the field the
    # tsvector covers and show its opening.
    return "description", _snippet(issue.description, query)


def _snippet(text: Optional[str], needle: str) -> str:
    """A window of `text` around the first occurrence of `needle`."""
    if not text:
        return ""
    position = text.lower().find(needle.lower())
    if position == -1:
        return text[: SNIPPET_RADIUS * 2].strip()

    start = max(0, position - SNIPPET_RADIUS)
    end = min(len(text), position + len(needle) + SNIPPET_RADIUS)
    window = text[start:end].strip()
    return f"{'…' if start > 0 else ''}{window}{'…' if end < len(text) else ''}"
