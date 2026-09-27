"""Full-text search over ticket titles, descriptions and comments.

Two implementations behind one function, chosen by the dialect at runtime:

* **Postgres** uses `to_tsvector` / `plainto_tsquery` ranked by `ts_rank`,
  backed by GIN indexes. That is the deployment target, and the one that stays
  fast and handles stemming -- "deploying" finds "deploy".
* **SQLite** uses FTS5 (#85): tables over the same text, kept in step by
  triggers -- see search_fts.py -- ranked by `bm25()`, with Porter stemming
  so "deploying" finds "deploy" here too. Only a SQLite built without FTS5
  falls back to case-insensitive LIKE, which has no ranking and no stemming.

Two properties hold either way. Tenancy is filtered *in the query*, never as a
post-filter, so a bug in ranking or pagination can never widen the scope. And
the cost is a fixed number of queries per page -- count, page, comments --
rather than one per result.
"""

from typing import Optional

from sqlalchemy import (
    Float,
    Integer,
    String,
    cast,
    func,
    literal_column,
    or_,
    select as sa_select,
    text,
)
from sqlmodel import Session, select

from lib_softtrack.models.page import DEFAULT_LIMIT, Page
from lib_softtrack.models.search import SearchHit
from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.search_fts import fts_query
from lib_softtrack.tables import (
    Comment,
    Ticket,
    Team,
    TeamMember,
    User,
    WorkflowStatus,
)

#: Characters of context to show either side of a match.
SNIPPET_RADIUS = 90


def search_tickets(
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
    fts = not postgres and _fts_ready(session)
    if postgres:
        condition, order_by = _postgres_query(query, team_ids)
    elif fts:
        match = fts_query(query)
        if match is None:
            # Nothing but punctuation: no words to look for, so nothing
            # matches -- which is what plainto_tsquery makes of it too.
            return Page(items=[], total=0, limit=limit, offset=offset)
        condition, order_by = _fts_query(match, team_ids)
    else:
        condition, order_by = _like_query(query, team_ids)

    total = session.exec(
        select(func.count()).select_from(Ticket).where(condition)
    ).one()

    tickets = list(
        session.exec(
            select(Ticket)
            .where(condition)
            .order_by(*order_by)
            .offset(offset)
            .limit(limit)
        ).all()
    )
    if not tickets:
        return Page(items=[], total=total, limit=limit, offset=offset)

    # One query for every matching comment on the page, rather than one per
    # result. Ordered so the first row per ticket is the earliest match.
    # The same matching rule as the search itself, so a comment that found a
    # ticket through stemming ("deploying" for "deploy") is the one quoted.
    comment_matches = (
        Comment.id.in_(_fts_matches("comment_fts", fts_query(query)))
        if fts
        else cast(Comment.body, String).ilike(f"%{query}%")
    )
    comment_by_ticket: dict[int, str] = {}
    for comment in session.exec(
        select(Comment)
        .where(
            Comment.ticket_id.in_([ticket.id for ticket in tickets]), comment_matches
        )
        .order_by(Comment.created_at)
    ).all():
        comment_by_ticket.setdefault(comment.ticket_id, comment.body)

    teams = {
        team.id: team
        for team in session.exec(
            select(Team).where(Team.id.in_({ticket.team_id for ticket in tickets}))
        ).all()
    }
    # Search reaches across every team the caller is in, so a page of hits can
    # carry statuses from several different workflows.
    statuses = {
        status.id: status
        for status in session.exec(
            select(WorkflowStatus).where(
                WorkflowStatus.id.in_({ticket.status_id for ticket in tickets})
            )
        ).all()
    }

    items = []
    for ticket in tickets:
        matched_in, snippet = _attribute(
            ticket, query, comment_by_ticket.get(ticket.id)
        )
        items.append(
            SearchHit(
                id=ticket.id,
                identifier=f"{teams[ticket.team_id].key}-{ticket.number}",
                title=ticket.title,
                status=StatusRead.model_validate(statuses[ticket.status_id]),
                priority=ticket.priority,
                team_id=ticket.team_id,
                team_key=teams[ticket.team_id].key,
                number=ticket.number,
                updated_at=ticket.updated_at,
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
    """The searchable text of a ticket.

    Concatenated with `||` rather than `concat_ws`, because `concat_ws` is
    STABLE and Postgres refuses to build an index on a non-IMMUTABLE
    expression. This must stay character-identical to the expression in the
    migration that creates the index, or the planner will quietly ignore it
    and fall back to a sequential scan.
    """
    return func.to_tsvector(
        _ENGLISH, Ticket.title + " " + func.coalesce(Ticket.description, "")
    )


def _postgres_query(query: str, team_ids: list[int]):
    document = _document()
    tsquery = func.plainto_tsquery(_ENGLISH, query)

    comment_matches = sa_select(Comment.ticket_id).where(
        func.to_tsvector(_ENGLISH, Comment.body).op("@@")(tsquery)
    )

    condition = (Ticket.team_id.in_(team_ids)) & or_(
        document.op("@@")(tsquery),
        Ticket.id.in_(comment_matches),
    )
    # Relevance first, recency as the tie-break: two equally relevant tickets
    # are not equally interesting, and the fresher one almost always is.
    rank = cast(func.ts_rank(document, tsquery), Float)
    return condition, (rank.desc(), Ticket.updated_at.desc())


def _fts_ready(session: Session) -> bool:
    """Whether this SQLite database has the FTS5 index. Only a SQLite built
    without FTS5 lacks it, and that one keeps the LIKE path."""
    return (
        session.exec(
            text(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ticket_fts'"
            )
        ).first()
        is not None
    )


def _fts_matches(table: str, match: str):
    """The rowids `match` finds in one FTS5 table, as a subquery.

    `match` goes in as a bound parameter, never into the SQL text -- and it
    has already been through `fts_query`, which leaves nothing FTS5 would read
    as an operator.
    """
    return (
        text(f"SELECT rowid AS id FROM {table} WHERE {table} MATCH :match")
        .bindparams(match=match)
        .columns(id=Integer)
        .subquery()
        .select()
    )


def _fts_query(match: str, team_ids: list[int]):
    """The FTS5 search, held to the same contract as the Postgres one.

    Relevance first, from the ticket's own title and description; a ticket
    found only through a comment comes after every ticket whose own text
    matched, as with `ts_rank` on Postgres, which scores such a ticket 0.
    Recency breaks ties. bm25() is "lower is better", so it sorts ascending.
    """
    scored = (
        text(
            "SELECT rowid AS id, bm25(ticket_fts) AS score"
            " FROM ticket_fts WHERE ticket_fts MATCH :match"
        )
        .bindparams(match=match)
        .columns(id=Integer, score=Float)
        .subquery()
    )
    comment_ids = _fts_matches("comment_fts", match)
    found_via_comment = sa_select(Comment.ticket_id).where(Comment.id.in_(comment_ids))

    condition = (Ticket.team_id.in_(team_ids)) & or_(
        Ticket.id.in_(sa_select(scored.c.id)),
        Ticket.id.in_(found_via_comment),
    )
    score = sa_select(scored.c.score).where(scored.c.id == Ticket.id).scalar_subquery()
    # Past any real bm25() score, which is never positive.
    unmatched = 1e9
    return condition, (func.coalesce(score, unmatched).asc(), Ticket.updated_at.desc())


def _like_query(query: str, team_ids: list[int]):
    pattern = f"%{query}%"
    comment_matches = sa_select(Comment.ticket_id).where(
        cast(Comment.body, String).ilike(pattern)
    )

    condition = (Ticket.team_id.in_(team_ids)) & or_(
        cast(Ticket.title, String).ilike(pattern),
        cast(Ticket.description, String).ilike(pattern),
        Ticket.id.in_(comment_matches),
    )
    # No ranking function available, so approximate it: a title hit is almost
    # always what someone typing a couple of words is looking for.
    title_first = cast(Ticket.title, String).ilike(pattern).desc()
    return condition, (title_first, Ticket.updated_at.desc())


def _attribute(
    ticket: Ticket, query: str, comment_body: Optional[str]
) -> tuple[str, str]:
    """Which field to credit the hit to, and the snippet to show for it.

    Shown next to the result, so a hit whose title does not visibly contain
    the search term does not look like a mistake.
    """
    needle = query.lower()
    if needle in (ticket.title or "").lower():
        return "title", _snippet(ticket.description, query) or ticket.title
    if needle in (ticket.description or "").lower():
        return "description", _snippet(ticket.description, query)
    if comment_body:
        return "comment", _snippet(comment_body, query)
    # Postgres matched a stem that a plain substring check cannot see (the
    # query "deploying" against the word "deploy"). Credit the field the
    # tsvector covers and show its opening.
    return "description", _snippet(ticket.description, query)


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
