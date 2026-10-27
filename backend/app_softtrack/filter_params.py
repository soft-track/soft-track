"""The board's filters, read from a query string (#260).

One dependency for the ticket list and its CSV export, so the two take the
same filters under the same names and an export cannot match a different set
of tickets from the board it was taken from.

A filter that takes several values repeats: `?assignee_id=3&assignee_id=4`.
One value is a list of one, which is how every request made before filters
took lists still means what it did.

Search (`GET /search`) reads the same dependency (#261), so a search can be
narrowed by the filters a list has.
"""

from datetime import date
from typing import Optional

from fastapi import Query
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from lib_softtrack.models.views import ViewFilters
from lib_softtrack.tables import (
    DateWindow,
    DueFilter,
    LabelMatch,
    TicketSeverity,
    MissingField,
    TicketPriority,
    TicketType,
)

_EXCLUDE = "Every ticket except those the filter matches."
#: A bug's details narrow to bugs either way round (#273).
_BUG_EXCLUDE = "Every bug except those the filter matches."


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
    assignee_me: bool = Query(
        False,
        description="The caller, as one more assignee choice: whoever asks, "
        "not whoever saved the view (#261).",
    ),
    creator_id: list[int] = Query(
        [], description="Only tickets created by one of these people."
    ),
    creator_me: bool = Query(
        False, description="The caller, as one more creator choice."
    ),
    creator_exclude: bool = Query(False, description=_EXCLUDE),
    watching: bool = Query(False, description="Only tickets the caller watches."),
    updated: Optional[DateWindow] = Query(
        None,
        description="Updated in the last 7 or 30 days, or more than 30 days "
        "ago, counted from `today`.",
    ),
    updated_from: Optional[date] = Query(
        None, description="Only tickets last updated on or after this day (UTC)."
    ),
    updated_to: Optional[date] = Query(
        None, description="Only tickets last updated on or before this day (UTC)."
    ),
    created: Optional[DateWindow] = Query(
        None, description="Created in the last 7 or 30 days, or before that."
    ),
    created_from: Optional[date] = Query(
        None, description="Only tickets created on or after this day (UTC)."
    ),
    created_to: Optional[date] = Query(
        None, description="Only tickets created on or before this day (UTC)."
    ),
    has_no: list[MissingField] = Query(
        [],
        description="Only tickets with no estimate, no epic, no sprint or no "
        "release.",
    ),
    fix_version_id: list[int] = Query(
        [], description="Only tickets shipping in one of these releases (#272)."
    ),
    fix_version_exclude: bool = Query(False, description=_EXCLUDE),
    severity: list[TicketSeverity] = Query(
        [], description="Only bugs of one of these severities (#273)."
    ),
    severity_exclude: bool = Query(False, description=_BUG_EXCLUDE),
    environment: list[str] = Query(
        [], description="Only bugs found in one of these environments."
    ),
    environment_exclude: bool = Query(False, description=_BUG_EXCLUDE),
    found_in_id: list[int] = Query(
        [], description="Only bugs found in one of these releases."
    ),
    found_in_exclude: bool = Query(False, description=_BUG_EXCLUDE),
) -> ViewFilters:
    try:
        # Every parameter above, by name: they are ViewFilters' own names.
        return ViewFilters(**locals())
    except ValidationError as error:
        # A range that runs backwards is the caller's mistake: a 422 like any
        # other bad query parameter, not a 500.
        raise RequestValidationError(
            error.errors(include_url=False, include_context=False)
        ) from error
