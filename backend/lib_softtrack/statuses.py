"""A team's workflow: the statuses on its board, and what they mean.

The one rule everything else depends on: **nothing outside this module asks a
status for its name.** Burndown, velocity, cycle completion, sub-issue
progress and "does this blocker still block" all ask for a *category*, which
is a fixed five-value enum. That is what makes letting a team invent "Blocked"
or "QA" safe, and it is why `in_category` below exists rather than a list of
status names somewhere.
"""

from typing import Iterable, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from lib_softtrack import automations as automations_service
from lib_softtrack.models.statuses import (
    StatusCreate,
    StatusDelete,
    StatusOrder,
    StatusRead,
    StatusUpdate,
)
from lib_softtrack.tables import (
    DEFAULT_STATUSES,
    Issue,
    SavedView,
    StatusCategory,
    User,
    WorkflowStatus,
)
from lib_softtrack.teams import (
    get_team_or_404,
    require_team_admin,
    require_team_member,
)

#: Work that is finished, one way or the other. Off the burndown, and unable
#: to block anything.
RESOLVED = (StatusCategory.done, StatusCategory.cancelled)


def in_category(*categories: StatusCategory):
    """A SQL clause for "this issue's status means one of these things".

    A subquery on the status table rather than a join, so it composes with the
    other filters on a query without changing its cardinality. Status rows
    already belong to exactly one team, so no team filter is needed here.
    """
    return Issue.status_id.in_(
        select(WorkflowStatus.id).where(WorkflowStatus.category.in_(categories))
    )


def create_default_statuses(session: Session, team_id: int) -> list[WorkflowStatus]:
    """The workflow a new team starts with: what the fixed enum used to be.

    Added on team creation rather than lazily, so a team always has somewhere
    to put an issue and the board is never empty on the first load.
    """
    statuses = [
        WorkflowStatus(
            team_id=team_id, name=name, category=category, position=index, color=color
        )
        for index, (name, category, color) in enumerate(DEFAULT_STATUSES)
    ]
    for status in statuses:
        session.add(status)
    session.flush()
    return statuses


def team_statuses(session: Session, team_id: int) -> list[WorkflowStatus]:
    return list(
        session.exec(
            select(WorkflowStatus)
            .where(WorkflowStatus.team_id == team_id)
            .order_by(WorkflowStatus.position, WorkflowStatus.id)
        ).all()
    )


def default_status(session: Session, team_id: int) -> WorkflowStatus:
    """Where a new issue lands: the leftmost column.

    Not "the backlog one" -- a team is free to delete that, and the first
    column is what someone filing an issue is looking at anyway.
    """
    statuses = team_statuses(session, team_id)
    if not statuses:
        # Unreachable while every team is created with the defaults and the
        # last status cannot be deleted. Worth a clear error rather than an
        # IndexError if a future path ever manages it.
        raise HTTPException(
            status_code=409, detail="This team has no statuses to put an issue in"
        )
    return statuses[0]


def get_status_or_404(
    session: Session, current_user: User, status_id: int
) -> WorkflowStatus:
    status = session.get(WorkflowStatus, status_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Status not found")
    require_team_member(status.team_id, current_user, session)
    return status


def resolve_for_team(
    session: Session, team_id: int, status_id: Optional[int]
) -> Optional[WorkflowStatus]:
    """A status id from a request, checked against the team it is being used on.

    Without this an issue could be moved into another team's column, which
    would take it off its own board entirely.
    """
    if status_id is None:
        return None
    status = session.get(WorkflowStatus, status_id)
    if status is None or status.team_id != team_id:
        raise HTTPException(status_code=400, detail="No such status on this team")
    return status


def read_many(statuses: Iterable[WorkflowStatus]) -> list[StatusRead]:
    return [StatusRead.model_validate(status) for status in statuses]


def list_statuses(
    session: Session, current_user: User, team_id: int
) -> list[StatusRead]:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    return read_many(team_statuses(session, team_id))


def _assert_name_free(
    session: Session, team_id: int, name: str, except_id: Optional[int] = None
) -> None:
    statement = select(WorkflowStatus).where(
        WorkflowStatus.team_id == team_id, WorkflowStatus.name == name
    )
    if except_id is not None:
        statement = statement.where(WorkflowStatus.id != except_id)
    if session.exec(statement).first():
        raise HTTPException(
            status_code=400, detail="This team already has a status with that name"
        )


def create_status(
    session: Session, current_user: User, team_id: int, payload: StatusCreate
) -> StatusRead:
    get_team_or_404(team_id, session)
    # Admin-only, unlike labels and projects: this is the shape of everyone's
    # board and the vocabulary every report is written in.
    require_team_admin(team_id, current_user, session)

    name = payload.name.strip()
    _assert_name_free(session, team_id, name)

    existing = team_statuses(session, team_id)
    status = WorkflowStatus(
        team_id=team_id,
        name=name,
        category=payload.category,
        color=payload.color,
        # Appended. Where a new column belongs is a judgement call, and the
        # team can drag it; guessing from the category would put "Blocked"
        # somewhere surprising.
        position=(existing[-1].position + 1) if existing else 0,
    )
    session.add(status)
    session.commit()
    session.refresh(status)
    return StatusRead.model_validate(status)


def update_status(
    session: Session, current_user: User, status_id: int, payload: StatusUpdate
) -> StatusRead:
    status = get_status_or_404(session, current_user, status_id)
    require_team_admin(status.team_id, current_user, session)

    if payload.name is not None:
        name = payload.name.strip()
        _assert_name_free(session, status.team_id, name, except_id=status.id)
        status.name = name
    if payload.category is not None:
        status.category = payload.category
    if payload.color is not None:
        status.color = payload.color

    session.add(status)
    session.commit()
    session.refresh(status)
    return StatusRead.model_validate(status)


def reorder_statuses(
    session: Session, current_user: User, team_id: int, payload: StatusOrder
) -> list[StatusRead]:
    get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)

    statuses = team_statuses(session, team_id)
    if sorted(payload.status_ids) != sorted(status.id for status in statuses):
        # Anything less than the whole set means the client is working from a
        # stale board -- somebody else added or removed a column. Applying it
        # would silently drop or duplicate positions.
        raise HTTPException(
            status_code=400,
            detail="Reordering takes every status on the team, exactly once",
        )

    by_id = {status.id: status for status in statuses}
    for position, status_id in enumerate(payload.status_ids):
        by_id[status_id].position = position
        session.add(by_id[status_id])

    session.commit()
    return read_many(team_statuses(session, team_id))


def delete_status(
    session: Session, current_user: User, status_id: int, payload: StatusDelete
) -> list[StatusRead]:
    """Remove a status, moving its issues to another one.

    The move is the whole point: issues hold a foreign key here, and silently
    deleting somebody's work along with a column would be the worst possible
    reading of "delete this status".
    """
    status = get_status_or_404(session, current_user, status_id)
    require_team_admin(status.team_id, current_user, session)

    remaining = [
        other
        for other in team_statuses(session, status.team_id)
        if other.id != status.id
    ]
    if not remaining:
        raise HTTPException(
            status_code=409,
            detail="A team needs at least one status; there would be nowhere to put its issues.",
        )

    target = session.get(WorkflowStatus, payload.move_to_id)
    if target is None or target.team_id != status.team_id:
        raise HTTPException(status_code=400, detail="No such status on this team")
    if target.id == status.id:
        raise HTTPException(
            status_code=400, detail="Move the issues to a different status"
        )

    # No history is written for the move. These issues did not change state --
    # the column they were sitting in was renamed out from under them -- and a
    # status event per issue would put a step in every cumulative flow diagram
    # on the day an admin tidied up the board.
    for issue in session.exec(select(Issue).where(Issue.status_id == status.id)).all():
        issue.status_id = target.id
        session.add(issue)

    # Saved views filtering on it lose the filter rather than the view: a view
    # pointing at a status that no longer exists would match nothing, which
    # reads as broken filtering rather than as a widened filter.
    for view in session.exec(
        select(SavedView).where(SavedView.status_id == status.id)
    ).all():
        view.status_id = None
        session.add(view)

    # Automation rules follow the issues instead of losing the reference. A
    # rule's condition read as "no opinion" when cleared, which would widen it
    # to every issue on the team -- see automations.move_status.
    automations_service.move_status(session, status.id, target.id)

    session.flush()
    session.delete(status)
    session.commit()
    return read_many(team_statuses(session, status.team_id))
