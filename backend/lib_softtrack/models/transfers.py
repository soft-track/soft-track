from typing import Optional

from pydantic import BaseModel

from lib_softtrack.models.tickets import TicketRead


class TicketTransfer(BaseModel):
    """Where to move a ticket (#98)."""

    team_id: int


class StatusChange(BaseModel):
    from_name: str
    to_name: str
    #: False when the target team has no status in the same category and the
    #: ticket lands in its first column instead.
    same_category: bool


class TransferPlan(BaseModel):
    """What moving a ticket to another team would change, before it does.

    The confirmation dialog shows this, and `transfer_ticket` carries out the
    same plan -- they are computed by one function, so the summary a person
    agreed to is the change they get.
    """

    from_identifier: str
    #: The key it would get now. Another ticket filed on the target team before
    #: the move is confirmed takes this number, so the move itself says which
    #: key it really got.
    to_identifier: str
    status: StatusChange
    labels_kept: list[str]
    labels_dropped: list[str]
    #: Names of what is cleared, or null when there was nothing to clear.
    sprint_cleared: Optional[str] = None
    project_cleared: Optional[str] = None
    #: The assignee, when they are not on the target team.
    assignee_cleared: Optional[str] = None
    #: The parent it leaves behind, when this is a sub-ticket.
    parent_detached: Optional[str] = None
    #: Sub-tickets that move with it, by current identifier.
    sub_tickets: list[str]


class TransferResult(BaseModel):
    ticket: TicketRead
    #: The sub-tickets that moved with it, in their new team.
    sub_tickets: list[TicketRead]
