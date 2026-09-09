from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.tables import IssueLinkType, IssuePriority


class IssueLinkCreate(BaseModel):
    target_id: int
    type: IssueLinkType


class LinkedIssue(BaseModel):
    """Just enough of the other issue to render a row and click through."""

    id: int
    team_key: str
    number: int
    identifier: str
    title: str
    status: StatusRead
    priority: IssuePriority


class IssueLinkRead(BaseModel):
    id: int
    #: How the relationship reads *from the issue that was asked about*. The
    #: stored row is one direction; this is the direction the caller sees, so
    #: a `blocks` row shows as "blocks" on the source and "blocked by" on the
    #: target without either side storing a second row.
    relation: str
    issue: LinkedIssue
    created_at: datetime


class IssueLinks(BaseModel):
    blocks: list[IssueLinkRead] = []
    blocked_by: list[IssueLinkRead] = []
    relates_to: list[IssueLinkRead] = []
    duplicates: list[IssueLinkRead] = []
    duplicated_by: list[IssueLinkRead] = []


class BlockedSummary(BaseModel):
    """Why a card is marked blocked on the board."""

    count: int
    first_blocker: Optional[str] = None
