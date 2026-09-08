"""Relationships between issues.

One row per relationship, read from both ends. Storing `A blocks B` and
separately `B blocked by A` would let the two halves drift apart the moment a
delete missed one of them; deriving the inverse at read time means they cannot.
"""

from fastapi import HTTPException, status as http_status
from sqlmodel import Session, select

from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.models.links import (
    IssueLinkCreate,
    IssueLinkRead,
    IssueLinks,
    LinkedIssue,
)
from lib_softtrack.tables import (
    DIRECTED_LINK_TYPES,
    Issue,
    IssueLink,
    IssueLinkType,
    Team,
    User,
    WorkflowStatus,
)
from lib_softtrack.statuses import RESOLVED, in_category
from lib_softtrack.teams import require_team_member

#: An issue whose status means one of these cannot block anything -- it is
#: finished. Used to decide whether a card is *currently* blocked, as opposed
#: to having ever had a blocker. Categories, so a team's own "Shipped" column
#: counts without anyone having to list it here.
RESOLVED_STATUSES = RESOLVED

#: How each stored type reads from the source end and from the target end.
_RELATION_NAMES: dict[IssueLinkType, tuple[str, str]] = {
    IssueLinkType.blocks: ("blocks", "blocked_by"),
    IssueLinkType.duplicates: ("duplicates", "duplicated_by"),
    IssueLinkType.relates_to: ("relates_to", "relates_to"),
}


def _issue_or_404(session: Session, issue_id: int) -> Issue:
    issue = session.get(Issue, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


def _linked_issue(
    issue: Issue, teams: dict[int, Team], statuses: dict[int, WorkflowStatus]
) -> LinkedIssue:
    return LinkedIssue(
        id=issue.id,
        identifier=f"{teams[issue.team_id].key}-{issue.number}",
        title=issue.title,
        status=StatusRead.model_validate(statuses[issue.status_id]),
        priority=issue.priority,
    )


def create_link(
    session: Session, current_user: User, issue_id: int, payload: IssueLinkCreate
) -> IssueLinkRead:
    source = _issue_or_404(session, issue_id)
    target = _issue_or_404(session, payload.target_id)

    # Membership of *both* teams. Linking across teams is useful, but it must
    # not become a way to learn that an issue exists in a team you are not in.
    require_team_member(source.team_id, current_user, session)
    require_team_member(target.team_id, current_user, session)

    if source.id == target.id:
        raise HTTPException(
            status_code=400, detail="An issue cannot be linked to itself."
        )

    if _link_exists(session, source.id, target.id, payload.type):
        raise HTTPException(
            status_code=409, detail="These issues are already linked that way."
        )

    if payload.type is IssueLinkType.relates_to:
        # Symmetric: B relates to A is the same fact as A relates to B, so the
        # mirror is a duplicate rather than a second relationship.
        if _link_exists(session, target.id, source.id, payload.type):
            raise HTTPException(
                status_code=409, detail="These issues are already related."
            )
    elif payload.type in DIRECTED_LINK_TYPES:
        # Direction means something here, so the pair cannot point both ways:
        # "A blocks B and B blocks A" describes work that can never start.
        if _link_exists(session, target.id, source.id, payload.type):
            forward, inverse = _RELATION_NAMES[payload.type]
            raise HTTPException(
                status_code=409,
                detail=(
                    f"That would contradict an existing link: this issue is "
                    f"already {inverse.replace('_', ' ')} that one."
                ),
            )

    link = IssueLink(
        source_id=source.id,
        target_id=target.id,
        type=payload.type,
        created_by_id=current_user.id,
    )
    session.add(link)
    session.commit()
    session.refresh(link)

    teams = _teams_for(session, [target])
    statuses = _statuses_for(session, [target])
    forward, _ = _RELATION_NAMES[payload.type]
    return IssueLinkRead(
        id=link.id,
        relation=forward,
        issue=_linked_issue(target, teams, statuses),
        created_at=link.created_at,
    )


def delete_link(
    session: Session, current_user: User, issue_id: int, link_id: int
) -> None:
    issue = _issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)

    link = session.get(IssueLink, link_id)
    # Either end may remove the relationship -- it belongs to both issues, and
    # requiring the author to undo it would strand links when people leave.
    if link is None or issue.id not in (link.source_id, link.target_id):
        raise HTTPException(status_code=404, detail="Link not found on this issue")

    session.delete(link)
    session.commit()


def list_links(session: Session, current_user: User, issue_id: int) -> IssueLinks:
    issue = _issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)

    outgoing = session.exec(
        select(IssueLink).where(IssueLink.source_id == issue.id)
    ).all()
    incoming = session.exec(
        select(IssueLink).where(IssueLink.target_id == issue.id)
    ).all()

    other_ids = {link.target_id for link in outgoing} | {
        link.source_id for link in incoming
    }
    issues = {
        other.id: other
        for other in session.exec(select(Issue).where(Issue.id.in_(other_ids))).all()
    }
    teams = _teams_for(session, issues.values())
    statuses = _statuses_for(session, issues.values())

    links = IssueLinks()
    for link, other_id, end in [
        *((link, link.target_id, 0) for link in outgoing),
        *((link, link.source_id, 1) for link in incoming),
    ]:
        other = issues.get(other_id)
        if other is None:
            continue
        relation = _RELATION_NAMES[link.type][end]
        getattr(links, relation).append(
            IssueLinkRead(
                id=link.id,
                relation=relation,
                issue=_linked_issue(other, teams, statuses),
                created_at=link.created_at,
            )
        )

    return links


def open_blocker_counts(session: Session, issue_ids: list[int]) -> dict[int, int]:
    """How many unresolved issues block each of `issue_ids`.

    One query for the whole page, so adding this to the issue list does not
    reintroduce the per-issue queries removed in #10. Blockers that are done
    or cancelled do not count: an issue is blocked by work still outstanding,
    not by work that once blocked it.
    """
    if not issue_ids:
        return {}

    rows = session.exec(
        select(IssueLink.target_id)
        .join(Issue, Issue.id == IssueLink.source_id)
        .where(
            IssueLink.type == IssueLinkType.blocks,
            IssueLink.target_id.in_(issue_ids),
            ~in_category(*RESOLVED_STATUSES),
        )
    ).all()

    counts: dict[int, int] = {}
    for target_id in rows:
        counts[target_id] = counts.get(target_id, 0) + 1
    return counts


def _link_exists(
    session: Session, source_id: int, target_id: int, type_: IssueLinkType
) -> bool:
    return (
        session.exec(
            select(IssueLink).where(
                IssueLink.source_id == source_id,
                IssueLink.target_id == target_id,
                IssueLink.type == type_,
            )
        ).first()
        is not None
    )


def _teams_for(session: Session, issues) -> dict[int, Team]:
    team_ids = {issue.team_id for issue in issues}
    if not team_ids:
        return {}
    return {
        team.id: team
        for team in session.exec(select(Team).where(Team.id.in_(team_ids))).all()
    }


def _statuses_for(session: Session, issues) -> dict[int, WorkflowStatus]:
    """The status rows a set of issues points at, in one query.

    Links reach across teams, so these can come from several workflows -- and
    the panel renders each one with its own team's colour and name.
    """
    status_ids = {issue.status_id for issue in issues}
    if not status_ids:
        return {}
    return {
        status.id: status
        for status in session.exec(
            select(WorkflowStatus).where(WorkflowStatus.id.in_(status_ids))
        ).all()
    }
