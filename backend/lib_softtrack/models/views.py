from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from lib_identity.models.identity import UserPublic
from lib_softtrack.tables import (
    DateWindow,
    DueFilter,
    LabelMatch,
    MissingField,
    TicketGrouping,
    TicketPriority,
    TicketSort,
    TicketType,
    SortDirection,
)


def _as_list(value: Any) -> Any:
    """One value reads as a list of one, and null as an empty list (#260).

    What keeps every view and request from before filters took lists meaning
    what it did: `{"status_id": 5}` is `{"status_id": [5]}`. Repeats are
    dropped, keeping the first, so two spellings of one filter compare equal.
    """
    if value is None:
        return []
    if not isinstance(value, (list, tuple, set)):
        return [value]
    seen: list = []
    for item in value:
        if item not in seen:
            seen.append(item)
    return seen


class ViewFilters(BaseModel):
    """What a view narrows the ticket list to.

    Nested rather than flattened into the view models so that the same shape
    is what the board sends, what a view stores, and what the frontend keeps
    in the URL -- one type to keep in step instead of three. The ticket list
    and its CSV export read their query string into this too (see
    app_softtrack/filter_params.py), and lib_softtrack/filters.py turns it
    into SQL, so a new filter is a field here, a parameter there and a clause
    there.

    Each of the first five filters takes a list (#260). Several values in one
    filter are alternatives -- Mei or Daniel -- and different filters narrow
    each other: Mei or Daniel, and bugs. Each has one switch, `*_exclude`, to
    turn it round: every status except Done. No grammar beyond that, and no
    nesting.

    Empty everywhere means "all tickets", which is what an empty view is.
    """

    status_id: list[int] = []
    status_exclude: bool = False
    priority: list[TicketPriority] = []
    priority_exclude: bool = False
    assignee_id: list[int] = []
    #: Nobody assigned, as one of the assignee choices: alone it is "only
    #: unassigned tickets", beside `assignee_id` it is "these people, or
    #: nobody". Leaving both empty means "anybody".
    unassigned: bool = False
    assignee_exclude: bool = False
    label_id: list[int] = []
    #: Any of the labels, or every one of them.
    label_match: LabelMatch = LabelMatch.any
    label_exclude: bool = False
    type: list[TicketType] = []
    type_exclude: bool = False

    project_id: Optional[int] = None
    sprint_id: Optional[int] = None
    #: Overdue, due this week, or no due date (#87). Measured from the
    #: viewer's own today when the view is applied, not from when it was saved.
    due: Optional[DueFilter] = None

    #: "Me" as one of the assignee choices (#261): whoever is looking, not
    #: whoever saved the view -- so a shared "assigned to me" shows each
    #: viewer their own tickets. Beside `assignee_id` it is "me, or Mei".
    assignee_me: bool = False
    #: Who created the ticket, in the same shape as the assignee (#261).
    creator_id: list[int] = []
    creator_me: bool = False
    creator_exclude: bool = False
    #: Only the tickets the viewer is watching.
    watching: bool = False
    #: When the ticket last changed: a window measured back from the viewer's
    #: today, or a range of days, both ends included (UTC days). Either end
    #: alone is "on or after" or "on or before".
    updated: Optional[DateWindow] = None
    updated_from: Optional[date] = None
    updated_to: Optional[date] = None
    #: When the ticket was created, the same way.
    created: Optional[DateWindow] = None
    created_from: Optional[date] = None
    created_to: Optional[date] = None
    #: Tickets with no estimate, no epic or no sprint -- each one asked narrows
    #: further. No assignee and no due date are the assignee and due filters'.
    has_no: list[MissingField] = []

    _lists = field_validator(
        "status_id",
        "priority",
        "assignee_id",
        "label_id",
        "type",
        "creator_id",
        "has_no",
        mode="before",
    )(_as_list)

    @model_validator(mode="after")
    def _ranges_run_forwards(self) -> "ViewFilters":
        for field in ("updated", "created"):
            start = getattr(self, f"{field}_from")
            end = getattr(self, f"{field}_to")
            if start is not None and end is not None and start > end:
                raise ValueError(f"{field}_from is after {field}_to")
        return self


class SavedViewCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    is_shared: bool = False
    filters: ViewFilters = ViewFilters()
    #: Beside the filters rather than inside them: a filter narrows the list
    #: and a grouping only arranges it, and `ViewFilters` is also the shape
    #: of the board's ticket query, which has no use for a grouping.
    group_by: TicketGrouping = TicketGrouping.status
    #: How the list is ordered (#88). Null is the default: newest first.
    sort: Optional[TicketSort] = None
    sort_direction: Optional[SortDirection] = None


class SavedViewUpdate(BaseModel):
    """Every field optional: renaming, re-filtering and sharing are separate
    gestures in the UI and each sends only what it changed."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    is_shared: Optional[bool] = None
    filters: Optional[ViewFilters] = None
    group_by: Optional[TicketGrouping] = None
    sort: Optional[TicketSort] = None
    sort_direction: Optional[SortDirection] = None


class SavedViewRead(BaseModel):
    id: int
    team_id: int
    name: str
    owner: UserPublic
    is_shared: bool
    filters: ViewFilters
    group_by: TicketGrouping
    sort: Optional[TicketSort] = None
    sort_direction: Optional[SortDirection] = None
    created_at: datetime
    updated_at: datetime


class SavedViews(BaseModel):
    """The whole sidebar in one response.

    The defaults come back with the list rather than from their own endpoint
    because the sidebar cannot render a row without knowing whether it is
    starred, and a second request would mean a frame where none of them are.
    """

    items: list[SavedViewRead]
    #: The team's default, set by an admin. Null when nobody has set one.
    team_default_id: Optional[int] = None
    #: This user's own override, if they have chosen one.
    my_default_id: Optional[int] = None
    #: What the board should actually open on: the override, else the team's.
    #: Resolved here so the client is not reimplementing the precedence rule.
    effective_default_id: Optional[int] = None


class DefaultViewUpdate(BaseModel):
    """Null clears the default rather than setting one."""

    view_id: Optional[int] = None
