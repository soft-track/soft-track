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

from datetime import date, timedelta
from typing import Any, Optional

from sqlalchemy import and_, func, not_, or_
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import select

from lib_softtrack.models.views import ViewFilters
from lib_softtrack.statuses import RESOLVED, in_category
from lib_softtrack.tables import DueFilter, LabelMatch, Ticket, TicketLabelLink


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


def filter_clauses(filters: ViewFilters, today: date) -> list[ColumnElement[bool]]:
    """The WHERE clauses for `filters`, ANDed by whoever runs them.

    `today` is the viewer's own, for the due filter's "this week".
    """
    clauses = [
        one_of(Ticket.status_id, filters.status_id, filters.status_exclude),
        one_of(Ticket.priority, filters.priority, filters.priority_exclude),
        one_of(
            Ticket.assignee_id,
            filters.assignee_id,
            filters.assignee_exclude,
            or_none=filters.unassigned,
        ),
        labels_clause(filters.label_id, filters.label_match, filters.label_exclude),
        one_of(Ticket.type, filters.type, filters.type_exclude),
    ]
    if filters.project_id is not None:
        clauses.append(Ticket.project_id == filters.project_id)
    if filters.sprint_id is not None:
        clauses.append(Ticket.sprint_id == filters.sprint_id)
    if filters.due is not None:
        clauses.append(due_clause(filters.due, today))
    return [clause for clause in clauses if clause is not None]
