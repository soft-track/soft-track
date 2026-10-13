"""Time estimates in hours, and what is left of them (#268).

A ticket's points say how big it is; its time estimate says what it was
meant to cost. They are different units and nothing converts one into the
other: a team estimates in points, in hours, or in both (`Team.estimate_unit`).

**Remaining** is the time estimate less what is logged, never below zero,
until somebody says otherwise by hand (`Ticket.remaining_minutes`). From then
on it is what they said, less what is logged after -- logging time asks "how
much is left?" with that answer filled in. A ticket that is done or cancelled
has nothing left, whatever was estimated.

Everything here sums in the database, grouped by whatever column a caller
asks for (`totals_by`), so a sprint, an epic, a person or a week of a
timesheet is the same query with a different GROUP BY.
"""

from typing import Any, Optional

from sqlalchemy import and_, case, func, or_
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, select

from lib_softtrack.history import record_changes, snapshot
from lib_softtrack.models.time_estimates import (
    OverTicket,
    TicketTimeEstimate,
    TimeRollup,
    TimeTotals,
)
from lib_softtrack.models.worklogs import WorklogCreate
from lib_softtrack.projects import get_project_or_404
from lib_softtrack.sprints import get_sprint_or_404
from lib_softtrack.statuses import RESOLVED, in_category
from lib_softtrack.tables import (
    Team,
    Ticket,
    User,
    WorkflowStatus,
    Worklog,
)
from lib_softtrack.teams import require_team_member
from lib_softtrack.tickets import get_ticket_or_404

#: The most over-estimate tickets a sprint or an epic lists.
OVER_LIMIT = 10


def remaining_of(
    estimate: Optional[int],
    remaining_set: Optional[int],
    logged: int,
    resolved: bool,
) -> Optional[int]:
    """What is left of one ticket, in minutes: the rule above, in Python.

    None when there is nothing to work it out from -- no time estimate and
    nothing set by hand.
    """
    if estimate is None and remaining_set is None:
        return None
    if resolved:
        return 0
    if remaining_set is not None:
        return remaining_set
    return max(estimate - logged, 0)


def _logged():
    """Minutes logged per ticket, as a subquery to join on."""
    return (
        select(
            Worklog.ticket_id.label("ticket_id"),
            func.sum(Worklog.minutes).label("minutes"),
        )
        .group_by(Worklog.ticket_id)
        .subquery()
    )


def _remaining(logged: Any):
    """`remaining_of`, as SQL over Ticket and a logged-minutes column."""
    return case(
        (
            Ticket.time_estimate_minutes.is_(None) & Ticket.remaining_minutes.is_(None),
            None,
        ),
        (in_category(*RESOLVED), 0),
        (Ticket.remaining_minutes.is_not(None), Ticket.remaining_minutes),
        (
            Ticket.time_estimate_minutes > logged,
            Ticket.time_estimate_minutes - logged,
        ),
        else_=0,
    )


def _sums(*group: Any):
    """Estimated, logged and remaining minutes as a SELECT over Ticket, with
    `group` in front of them."""
    logged = _logged()
    spent = func.coalesce(logged.c.minutes, 0)
    return (
        select(
            *group,
            func.coalesce(func.sum(Ticket.time_estimate_minutes), 0),
            func.coalesce(func.sum(spent), 0),
            func.coalesce(func.sum(_remaining(spent)), 0),
        )
        .select_from(Ticket)
        .outerjoin(logged, logged.c.ticket_id == Ticket.id)
    )


def _totals(estimated: Any, logged: Any, remaining: Any) -> TimeTotals:
    return TimeTotals(
        estimated_minutes=int(estimated),
        logged_minutes=int(logged),
        remaining_minutes=int(remaining),
    )


def totals_by(
    session: Session, column: Any, *where: ColumnElement[bool]
) -> dict[Any, TimeTotals]:
    """Estimated, logged and remaining minutes over the tickets matching
    `where`, grouped by `column` -- `Ticket.sprint_id`, `Ticket.assignee_id`,
    anything on the ticket. Groups with no tickets are absent."""
    rows = session.exec(_sums(column).where(*where).group_by(column)).all()
    return {key: _totals(*sums) for key, *sums in rows}


def totals(session: Session, *where: ColumnElement[bool]) -> TimeTotals:
    """The same over every ticket matching `where`, as one total."""
    return _totals(*session.exec(_sums().where(*where)).one())


def over(
    session: Session, *where: ColumnElement[bool], limit: int = OVER_LIMIT
) -> list[OverTicket]:
    """The tickets matching `where` with more logged than estimated, furthest
    over first."""
    logged = _logged()
    by = logged.c.minutes - Ticket.time_estimate_minutes
    rows = session.exec(
        select(Ticket, Team.key, logged.c.minutes, _remaining(logged.c.minutes))
        .join(Team, Team.id == Ticket.team_id)
        .join(logged, logged.c.ticket_id == Ticket.id)
        .where(*where, Ticket.time_estimate_minutes.is_not(None), by > 0)
        .order_by(by.desc(), Ticket.id)
        .limit(limit)
    ).all()
    return [
        OverTicket(
            id=ticket.id,
            team_key=key,
            number=ticket.number,
            identifier=f"{key}-{ticket.number}",
            title=ticket.title,
            estimated_minutes=ticket.time_estimate_minutes,
            logged_minutes=int(minutes),
            remaining_minutes=int(remaining or 0),
        )
        for ticket, key, minutes, remaining in rows
    ]


def rollup(session: Session, *where: ColumnElement[bool]) -> TimeRollup:
    """Totals and the tickets that are over, for a sprint or an epic."""
    return TimeRollup(
        **totals(session, *where).model_dump(), over=over(session, *where)
    )


def logged_by(session: Session, ticket_ids: list[int]) -> dict[int, int]:
    """Minutes logged on each of `ticket_ids` that has any."""
    if not ticket_ids:
        return {}
    return {
        ticket_id: int(minutes)
        for ticket_id, minutes in session.exec(
            select(Worklog.ticket_id, func.sum(Worklog.minutes))
            .where(Worklog.ticket_id.in_(ticket_ids))
            .group_by(Worklog.ticket_id)
        ).all()
    }


def _resolved(session: Session, ticket: Ticket) -> bool:
    status = session.get(WorkflowStatus, ticket.status_id)
    return status is not None and status.category in RESOLVED


def ticket_estimate(
    session: Session, current_user: User, ticket_id: int
) -> TicketTimeEstimate:
    """One ticket's estimate against what is logged, and with its sub-tickets."""
    ticket = get_ticket_or_404(session, ticket_id)
    require_team_member(ticket.team_id, current_user, session)
    logged = logged_by(session, [ticket.id]).get(ticket.id, 0)
    subticket_count = int(
        session.exec(
            select(func.count())
            .select_from(Ticket)
            .where(Ticket.parent_id == ticket.id)
        ).one()
    )
    return TicketTimeEstimate(
        estimated_minutes=ticket.time_estimate_minutes,
        logged_minutes=logged,
        remaining_minutes=remaining_of(
            ticket.time_estimate_minutes,
            ticket.remaining_minutes,
            logged,
            _resolved(session, ticket),
        ),
        remaining_set=ticket.remaining_minutes is not None,
        total=totals(
            session, or_(Ticket.id == ticket.id, Ticket.parent_id == ticket.id)
        ),
        subticket_count=subticket_count,
    )


def in_with_subtickets(column: Any, value: int) -> ColumnElement[bool]:
    """Tickets whose `column` is `value`, and the sub-tickets of those that
    leave it unset -- a parent's total includes its sub-tickets. A sub-ticket
    put in another sprint or epic of its own counts there instead."""
    parents = select(Ticket.id).where(column == value)
    return or_(column == value, and_(column.is_(None), Ticket.parent_id.in_(parents)))


def sprint_time(session: Session, current_user: User, sprint_id: int) -> TimeRollup:
    """A sprint's estimated, logged and remaining time."""
    sprint = get_sprint_or_404(session, sprint_id)
    require_team_member(sprint.team_id, current_user, session)
    return rollup(session, in_with_subtickets(Ticket.sprint_id, sprint.id))


def project_time(session: Session, current_user: User, project_id: int) -> TimeRollup:
    """An epic's estimated, logged and remaining time."""
    project = get_project_or_404(session, project_id)
    require_team_member(project.team_id, current_user, session)
    return rollup(session, in_with_subtickets(Ticket.project_id, project.id))


def after_logging(
    session: Session, ticket: Ticket, payload: WorklogCreate, actor: User
) -> None:
    """What logging time does to what is left (#268).

    Said with the entry, remaining is what was said -- or, sent as null,
    worked out again. Not said, a remaining somebody set by hand goes down by
    the time logged, and a worked-out one needs nothing: it is worked out.
    """
    before = snapshot(ticket)
    if "remaining_minutes" in payload.model_fields_set:
        ticket.remaining_minutes = payload.remaining_minutes
    elif ticket.remaining_minutes is not None:
        ticket.remaining_minutes = max(ticket.remaining_minutes - payload.minutes, 0)
    else:
        return
    record_changes(session, ticket, before, actor)
    session.add(ticket)
