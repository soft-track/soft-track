"""The board's filters, read from a query string (#260).

One dependency for the ticket list and its CSV export, so the two take the
same filters under the same names and an export cannot match a different set
of tickets from the board it was taken from.

A filter that takes several values repeats: `?assignee_id=3&assignee_id=4`.
One value is a list of one, which is how every request made before filters
took lists still means what it did.
"""

from typing import Optional

from fastapi import Query

from lib_softtrack.models.views import ViewFilters
from lib_softtrack.tables import DueFilter, LabelMatch, TicketPriority, TicketType

_EXCLUDE = "Every ticket except those the filter matches."


def ticket_filters(
    status_id: list[int] = Query(
        [], description="Only tickets in one of these statuses. Repeat for several."
    ),
    status_exclude: bool = Query(False, description=_EXCLUDE),
    priority: list[TicketPriority] = Query(
        [], description="Only tickets with one of these priorities."
    ),
    priority_exclude: bool = Query(False, description=_EXCLUDE),
    assignee_id: list[int] = Query(
        [], description="Only tickets assigned to one of these people."
    ),
    unassigned: bool = Query(
        False,
        description="Nobody assigned, as one more assignee choice: alone, only "
        "unassigned tickets; with assignee_id, those people or nobody.",
    ),
    assignee_exclude: bool = Query(False, description=_EXCLUDE),
    label_id: list[int] = Query(
        [], description="Only tickets with these labels, any or all of them."
    ),
    label_match: LabelMatch = Query(
        LabelMatch.any,
        description="any: tickets with at least one of the labels. all: with "
        "every one of them.",
    ),
    label_exclude: bool = Query(False, description=_EXCLUDE),
    type: list[TicketType] = Query([], description="Only tickets of these types."),
    type_exclude: bool = Query(False, description=_EXCLUDE),
    project_id: Optional[int] = Query(None, description="Only tickets in this epic."),
    sprint_id: Optional[int] = Query(None, description="Only tickets in this sprint."),
    due: Optional[DueFilter] = Query(
        None, description="Overdue, due this week, or with no due date."
    ),
) -> ViewFilters:
    return ViewFilters(
        status_id=status_id,
        status_exclude=status_exclude,
        priority=priority,
        priority_exclude=priority_exclude,
        assignee_id=assignee_id,
        unassigned=unassigned,
        assignee_exclude=assignee_exclude,
        label_id=label_id,
        label_match=label_match,
        label_exclude=label_exclude,
        type=type,
        type_exclude=type_exclude,
        project_id=project_id,
        sprint_id=sprint_id,
        due=due,
    )
