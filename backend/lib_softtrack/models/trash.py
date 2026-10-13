from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from lib_identity.models.identity import UserPublic
from lib_softtrack.tables import TicketType


class TrashedTicket(BaseModel):
    """A ticket in the trash (#323): what it was, who put it there and when,
    and when it goes for good."""

    id: int
    team_id: int
    number: int
    identifier: str
    title: str
    type: TicketType
    deleted_at: datetime
    deleted_by: Optional[UserPublic] = None
    #: When the purge takes it, with its comments, links and attachments.
    purge_at: datetime


class TrashedEpic(BaseModel):
    id: int
    team_id: int
    name: str
    color: str
    #: The tickets that still point at it and rejoin it if it is restored.
    ticket_count: int
    deleted_at: datetime
    deleted_by: Optional[UserPublic] = None
    purge_at: datetime


class Trash(BaseModel):
    """What a team has deleted and can still restore, newest first."""

    tickets: list[TrashedTicket]
    epics: list[TrashedEpic]
    #: How long anything stays before it is purged.
    retention_days: int
