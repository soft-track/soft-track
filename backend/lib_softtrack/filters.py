"""A set of board filters as SQL (#260).

`ViewFilters` is the one shape of "which tickets": what the board sends, what
a saved view stores and what a share link of a view lists. This turns it into
WHERE clauses, so the ticket list, its CSV export and a share link cannot read
the same filters differently.

The rule, the whole of it: several values in one filter are alternatives
(OR), different filters narrow each other (AND), and a filter's exclude switch
turns it round. A filter with no values has no opinion, exclude or not.

The filtering stays in the query. The list is paginated, and narrowing the page
that happened to load would answer a different, worse question.
"""

from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import and_, false, func, not_, or_
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import select

from lib_softtrack.models.views import ViewFilters
from lib_softtrack.statuses import RESOLVED, in_category
from lib_softtrack.tables import (
    DateWindow,
    DueFilter,
    EstimateUnit,
    LabelMatch,
    MissingField,
    Team,
    Ticket,
    TicketLabelLink,
    TicketWatch,
)

#: How far back each window reaches, in days from the viewer's today.
WINDOW_DAYS = {
    DateWindow.last_7_days: 7,
    DateWindow.last_30_days: 30,
    DateWindow.over_30_days: 30,
}

#: The column each "has no" asks about. An estimate is a question for
#: `no_estimate`: which one depends on the ticket's team.
_MISSING = {
    MissingField.epic: Ticket.project_id,
    MissingField.sprint: Ticket.sprint_id,
}


def _teams_in(*units: EstimateUnit):
    return select(Team.id).where(Team.estimate_unit.in_(units))


def no_estimate() -> ColumnElement[bool]:
    """Tickets missing the estimate their team estimates in (#268): points,
    a time estimate, or -- for a team that asks both -- either of them."""
    return or_(
        and_(
            Ticket.estimate.is_(None),
            Ticket.team_id.in_(_teams_in(EstimateUnit.points, EstimateUnit.both)),
        ),
        and_(
            Ticket.time_estimate_minutes.is_(None),
            Ticket.team_id.in_(_teams_in(EstimateUnit.hours, EstimateUnit.both)),
        ),
    )


def due_clause(due: DueFilter, today: date):
    """One of the three due-date questions, as a condition on Ticket (#87)."""
    if due == DueFilter.none:
        return Ticket.due_date == None  # noqa: E711 -- SQL IS NULL
    if due == DueFilter.overdue:
        # Late only while it is still open: finished work is not overdue,
        # however late it was finished.
        return (Ticket.due_date < today) & ~in_category(*RESOLVED)
    # Monday is 0, so this is the coming Sunday -- or today, on a Sunday.
    end_of_week = today + timedelta(days=6 - today.weekday())
    return (Ticket.due_date >= today) & (Ticket.due_date <= end_of_week)


def one_of(
    column: Any, values: list, exclude: bool = False, or_none: bool = False
) -> Optional[ColumnElement[bool]]:
    """`column` is one of `values` -- or, with `or_none`, empty -- or, with
    `exclude`, none of those. None when there is nothing to ask.

    Excluding keeps the rows where the column is empty unless `or_none` asked
    about them: "everyone except Mei" includes the unassigned tickets, which
    are not Mei's. SQL's `NOT IN` would quietly drop them.
    """
    if not values and not or_none:
        return None
    if exclude:
        parts = []
        if values:
            parts.append(or_(column.is_(None), column.not_in(values)))
        if or_none:
            parts.append(column.is_not(None))
        return and_(*parts)
    parts = []
    if values:
        parts.append(column.in_(values))
    if or_none:
        parts.append(column.is_(None))
    return or_(*parts)


def labels_clause(
    label_ids: list[int], match: LabelMatch, exclude: bool
) -> Optional[ColumnElement[bool]]:
    """Tickets carrying any -- or all -- of the labels, or, excluding, not.

    A subquery rather than a join: a ticket joined to its label links would
    come back once per matching link, so the list would count it that many
    times and the export would repeat the row.
    """
    if not label_ids:
        return None
    carrying = select(TicketLabelLink.ticket_id).where(
        TicketLabelLink.label_id.in_(label_ids)
    )
    if match == LabelMatch.all and len(label_ids) > 1:
        carrying = carrying.group_by(TicketLabelLink.ticket_id).having(
            func.count(TicketLabelLink.label_id.distinct()) == len(label_ids)
        )
    clause = Ticket.id.in_(carrying)
    return not_(clause) if exclude else clause


def _midnight(day: date) -> datetime:
    """The start of a day, in UTC, which is how every timestamp is stored."""
    return datetime.combine(day, time.min, tzinfo=timezone.utc)


def when_clauses(
    column: Any,
    window: Optional[DateWindow],
    start: Optional[date],
    end: Optional[date],
    today: date,
) -> list[ColumnElement[bool]]:
    """A timestamp within a window back from `today`, and/or within a range of
    days with both ends included (#261).

    "In the last 7 days" is since the start of the day a week before today,
    so it does not shift with the hour the list is opened; "more than 30
    days ago" is everything before that same line for 30.
    """
    clauses = []
    if window is not None:
        line = _midnight(today - timedelta(days=WINDOW_DAYS[window]))
        clauses.append(
            column < line if window == DateWindow.over_30_days else column >= line
        )
    if start is not None:
        clauses.append(column >= _midnight(start))
    if end is not None:
        clauses.append(column < _midnight(end + timedelta(days=1)))
    return clauses


def watched_by(viewer_id: int) -> ColumnElement[bool]:
    """Tickets `viewer_id` is watching: a row saying yes, not one saying no
    (see TicketWatch)."""
    return Ticket.id.in_(
        select(TicketWatch.ticket_id).where(
            TicketWatch.user_id == viewer_id,
            TicketWatch.watching == True,  # noqa: E712 -- SQL comparison
        )
    )


def _with_me(ids: list[int], me: bool, viewer_id: Optional[int]) -> list[int]:
    """`ids`, and the viewer's own when "me" is one of the choices."""
    if me and viewer_id is not None and viewer_id not in ids:
        return [*ids, viewer_id]
    return ids


def filter_clauses(
    filters: ViewFilters, today: date, viewer_id: Optional[int] = None
) -> list[ColumnElement[bool]]:
    """The WHERE clauses for `filters`, ANDed by whoever runs them.

    `today` is the viewer's own, for the due filter's "this week" and the
    updated and created windows. `viewer_id` is who "me" and "watching" mean
    (#261): the person looking, so a view about "me" is about each viewer.
    With nobody looking, "me" is nobody and nothing is watched.
    """
    assignees = _with_me(filters.assignee_id, filters.assignee_me, viewer_id)
    creators = _with_me(filters.creator_id, filters.creator_me, viewer_id)
    clauses = [
        one_of(Ticket.status_id, filters.status_id, filters.status_exclude),
        one_of(Ticket.priority, filters.priority, filters.priority_exclude),
        one_of(
            Ticket.assignee_id,
            assignees,
            filters.assignee_exclude,
            or_none=filters.unassigned,
        ),
        labels_clause(filters.label_id, filters.label_match, filters.label_exclude),
        one_of(Ticket.type, filters.type, filters.type_exclude),
        one_of(Ticket.creator_id, creators, filters.creator_exclude),
    ]
    # "Me" with nobody looking is nobody: chosen alone, it matches nothing
    # (and excluded, everything, which `one_of` already says).
    if viewer_id is None:
        if filters.assignee_me and not (
            assignees or filters.unassigned or filters.assignee_exclude
        ):
            clauses.append(false())
        if filters.creator_me and not (creators or filters.creator_exclude):
            clauses.append(false())
    if filters.project_id is not None:
        clauses.append(Ticket.project_id == filters.project_id)
    if filters.sprint_id is not None:
        clauses.append(Ticket.sprint_id == filters.sprint_id)
    if filters.due is not None:
        clauses.append(due_clause(filters.due, today))
    if filters.watching:
        clauses.append(watched_by(viewer_id) if viewer_id is not None else false())
    clauses.extend(
        when_clauses(
            Ticket.updated_at,
            filters.updated,
            filters.updated_from,
            filters.updated_to,
            today,
        )
    )
    clauses.extend(
        when_clauses(
            Ticket.created_at,
            filters.created,
            filters.created_from,
            filters.created_to,
            today,
        )
    )
    for missing in filters.has_no:
        clauses.append(
            no_estimate()
            if missing == MissingField.estimate
            else _MISSING[missing].is_(None)
        )
    return [clause for clause in clauses if clause is not None]
