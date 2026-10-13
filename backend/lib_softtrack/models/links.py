from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.tables import TicketLinkType, TicketPriority


class TicketLinkCreate(BaseModel):
    target_id: int
    type: TicketLinkType


class LinkedTicket(BaseModel):
    """Just enough of the other ticket to render a row and click through."""

    id: int
    team_key: str
    number: int
    identifier: str
    title: str
    status: StatusRead
    priority: TicketPriority


class TicketLinkRead(BaseModel):
    id: int
    #: How the relationship reads *from the ticket that was asked about*. The
    #: stored row is one direction; this is the direction the caller sees, so
    #: a `blocks` row shows as "blocks" on the source and "blocked by" on the
    #: target without either side storing a second row.
    relation: str
    ticket: LinkedTicket
    created_at: datetime


class TicketLinks(BaseModel):
    blocks: list[TicketLinkRead] = []
    blocked_by: list[TicketLinkRead] = []
    relates_to: list[TicketLinkRead] = []
    duplicates: list[TicketLinkRead] = []
    duplicated_by: list[TicketLinkRead] = []


class BlockedSummary(BaseModel):
    """Why a card is marked blocked on the board."""

    count: int
    first_blocker: Optional[str] = None
