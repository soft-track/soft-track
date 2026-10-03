from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

from lib_identity.models.identity import UserPublic
from lib_softtrack.tables import StatusCategory, TicketType


class ShareShows(BaseModel):
    """What a share link's page shows beside key, title, status and type
    (#245). Each is off unless the link turns it on."""

    comments: bool = False
    assignees: bool = False
    #: Estimates and time logged.
    estimates: bool = False
    attachments: bool = False


class ShareLinkCreate(BaseModel):
    """A share link for an epic or a saved view: exactly one of the two."""

    project_id: Optional[int] = None
    view_id: Optional[int] = None
    shows: ShareShows = ShareShows()
    #: Days until it stops working. None for never.
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=365)
    #: Asked of whoever opens it as well as the link. None for none.
    password: Optional[str] = Field(default=None, min_length=4, max_length=200)


class ShareLinkRead(BaseModel):
    """A link in the team's list. Never the token: that is shown once."""

    id: int
    team_id: int
    #: The epic's or the view's name, or null once it has gone.
    target_name: Optional[str] = None
    kind: Literal["epic", "view"]
    project_id: Optional[int] = None
    view_id: Optional[int] = None
    created_by: UserPublic
    created_at: datetime
    expires_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    has_password: bool
    shows: ShareShows
    open_count: int
    last_opened_at: Optional[datetime] = None
    #: Not revoked, not expired, and still pointing at something.
    active: bool


class ShareLinkCreated(BaseModel):
    link: ShareLinkRead
    #: The token, this once. The page is `/shared/{token}`.
    token: str


class SharedStatus(BaseModel):
    name: str
    category: StatusCategory
    color: str


class SharedComment(BaseModel):
    #: A name, never an address. Null for a comment an automation rule wrote.
    author: Optional[str] = None
    body: str
    created_at: datetime


class SharedAttachment(BaseModel):
    id: int
    filename: str
    content_type: str
    size_bytes: int


class SharedTicket(BaseModel):
    identifier: str
    title: str
    type: TicketType
    status: SharedStatus
    #: Each null unless the link shows it.
    assignee: Optional[str] = None
    estimate: Optional[int] = None
    minutes_logged: Optional[int] = None
    comments: Optional[list[SharedComment]] = None
    attachments: Optional[list[SharedAttachment]] = None


class SharedPage(BaseModel):
    """What whoever has a share link sees (#245): read-only, no sign-in."""

    team_name: str
    kind: Literal["epic", "view"]
    title: str
    description: Optional[str] = None
    color: Optional[str] = None
    target_date: Optional[date] = None
    ticket_count: int
    completed_ticket_count: int
    tickets: list[SharedTicket]
    #: How many matched beyond the ones listed, which stop at a few hundred.
    more: int = 0
    shows: ShareShows
    #: When any ticket on it last changed.
    updated_at: Optional[datetime] = None
