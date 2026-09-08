from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from lib_identity.models.identity import UserPublic
from lib_softtrack.tables import NotificationKind


class NotificationIssue(BaseModel):
    """Enough of the issue to render the row and navigate to it.

    `team_key` and `number` rather than a URL: the inbox links into the app's
    own routes (`/:teamKey/issue/:issueNumber`), and a server-built path would
    be a second place that has to change when they do.
    """

    id: int
    team_id: int
    team_key: str
    number: int
    identifier: str
    title: str


class NotificationRead(BaseModel):
    id: int
    kind: NotificationKind
    issue: NotificationIssue
    #: Absent for anything a person did not do -- see Notification.actor_id.
    actor: Optional[UserPublic] = None
    #: The first line or so of the comment, for `commented` and `mentioned`.
    #: Trimmed server-side so the inbox never downloads a 4,000-word comment
    #: to show forty characters of it.
    excerpt: Optional[str] = None
    read: bool
    created_at: datetime


class NotificationUpdate(BaseModel):
    """Marking one notification read, or putting it back."""

    read: bool


class UnreadCount(BaseModel):
    """The badge. Its own endpoint because it is polled, and the inbox is not."""

    unread: int


class WatchState(BaseModel):
    watching: bool


class NotificationSettings(BaseModel):
    email_notifications: bool
    #: Whether this instance can send mail at all. Read-only, and the reason
    #: the switch above is worth showing: with no SMTP configured the toggle
    #: would promise a digest that nothing is going to send.
    email_delivery_configured: bool


class NotificationSettingsUpdate(BaseModel):
    email_notifications: bool
