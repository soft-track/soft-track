from datetime import date, datetime
from typing import Annotated, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.labels import LabelRead
from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.tables import TicketPriority, TicketType

# A modified Fibonacci scale. The gaps are the point: they stop a team
# arguing about whether something is a 6 or a 7, a distinction no estimate is
# accurate enough to carry.
ESTIMATE_SCALE = (1, 2, 3, 5, 8)


def _on_the_scale(value: Optional[int]) -> Optional[int]:
    """Reject an estimate that is not on the scale.

    An explicit check rather than a `Literal` so the error names the scale: a
    422 reading "estimate must be null or one of 1, 2, 3, 5, 8" is actionable
    where pydantic's default union error is not.
    """
    if value is None or value in ESTIMATE_SCALE:
        return value
    allowed = ", ".join(str(point) for point in ESTIMATE_SCALE)
    raise ValueError(f"estimate must be null or one of {allowed}; got {value}")


Estimate = Annotated[
    Optional[int],
    AfterValidator(_on_the_scale),
    Field(
        json_schema_extra={"enum": [None, *ESTIMATE_SCALE]},
        description=(
            "Story points on the scale 1, 2, 3, 5, 8. Null means not sized "
            "yet, which is distinct from an estimate of zero."
        ),
    ),
]


class ParentRef(BaseModel):
    """Just enough of the parent to render a breadcrumb."""

    id: int
    team_key: str
    number: int
    identifier: str
    title: str


class TicketCreate(BaseModel):
    title: str
    description: Optional[str] = None
    project_id: Optional[int] = None
    #: Omitted means the team's leftmost column, which is where a new
    #: ticket belongs and is what `backlog` used to mean.
    status_id: Optional[int] = None
    priority: TicketPriority = TicketPriority.no_priority
    type: TicketType = TicketType.task
    assignee_id: Optional[int] = None
    estimate: Estimate = None
    parent_id: Optional[int] = None
    sprint_id: Optional[int] = None
    due_date: Optional[date] = None
    label_ids: list[int] = []


class TicketUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    project_id: Optional[int] = None
    status_id: Optional[int] = None
    priority: Optional[TicketPriority] = None
    type: Optional[TicketType] = None
    assignee_id: Optional[int] = None
    # `exclude_unset` in the service keeps "clear the estimate" (an explicit
    # null) distinct from "leave it alone" (the field omitted). The same
    # applies to parent_id below.
    estimate: Estimate = None
    #: An explicit null detaches the ticket from its parent.
    parent_id: Optional[int] = None
    #: An explicit null moves the ticket out of its sprint, back to the backlog.
    sprint_id: Optional[int] = None
    #: An explicit null clears the due date.
    due_date: Optional[date] = None
    label_ids: Optional[list[int]] = None


class TicketMove(BaseModel):
    """Where a card was dropped on the board (#88).

    The cards it landed between, as the board showed them: `above_id` is the
    one now above it, `below_id` the one below. Either is null at the top or
    bottom of a column, and both are null in an empty one. `status_id` moves
    it to another column at the same time.
    """

    above_id: Optional[int] = None
    below_id: Optional[int] = None
    status_id: Optional[int] = None


class TicketRead(BaseModel):
    id: int
    team_id: int
    team_key: str
    project_id: Optional[int] = None
    number: int
    identifier: str
    title: str
    description: Optional[str] = None
    status: StatusRead
    priority: TicketPriority
    type: TicketType
    #: The board's order (#88): a string compared by code point. Clients sort
    #: by it; they never make one -- moving a card is POST /tickets/{id}/move.
    rank: str
    assignee: Optional[UserPublic] = None
    estimate: Optional[int] = None
    #: Unresolved tickets that block this one. Zero for a ticket that is free
    #: to start; the board marks anything above zero.
    blocked_by_count: int
    sprint_id: Optional[int] = None
    due_date: Optional[date] = None
    #: The key this ticket had before it was imported, e.g. "PROJ-142".
    external_key: Optional[str] = None
    parent: Optional[ParentRef] = None
    #: Sub-ticket progress, excluding cancelled children from both numbers.
    #: Zero of zero for a ticket with no sub-tickets.
    child_count: int
    completed_child_count: int
    #: None of the three counts above carry a default. Every path that builds
    #: a TicketRead sets them, and defaulting them would make them optional in
    #: the schema, pushing an `undefined` check into every client.
    creator: UserPublic
    labels: list[LabelRead] = []
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


#: The most tickets one bulk request may touch. The board's page size, so
#: "select everything on screen" always fits in one request, and a mistake
#: can never reach further than what somebody could see when they made it.
MAX_BULK_TICKETS = 200

BulkTicketIds = Annotated[
    list[int],
    Field(
        min_length=1,
        max_length=MAX_BULK_TICKETS,
        description=f"Between 1 and {MAX_BULK_TICKETS} tickets, all on this team.",
    ),
]


class TicketBulkChanges(BaseModel):
    """What to do to every ticket in the batch. Omitted fields are left alone.

    The same unset-versus-null distinction as `TicketUpdate`: an explicit null
    assignee, project or sprint clears it on every ticket.
    """

    status_id: Optional[int] = None
    priority: Optional[TicketPriority] = None
    assignee_id: Optional[int] = None
    project_id: Optional[int] = None
    sprint_id: Optional[int] = None
    #: Labels are added and removed rather than replaced. Twenty tickets rarely
    #: share a label set, and "set these labels" across them would silently
    #: strip whatever each one had that the others did not.
    add_label_ids: list[int] = []
    remove_label_ids: list[int] = []


class TicketBulkUpdate(BaseModel):
    ticket_ids: BulkTicketIds
    changes: TicketBulkChanges


class TicketBulkDelete(BaseModel):
    ticket_ids: BulkTicketIds
