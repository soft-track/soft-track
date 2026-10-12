from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel

from lib_identity.models.identity import UserPublic
from lib_softtrack.notification_kinds import NotificationChannel
from lib_softtrack.tables import NotificationKind


class NotificationTicket(BaseModel):
    """Enough of the ticket to render the row and navigate to it.

    `team_key` and `number` rather than a URL: the inbox links into the app's
    own routes (`/:teamKey/ticket/:ticketNumber`), and a server-built path would
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
    ticket: NotificationTicket
    #: Absent for anything a person did not do -- see Notification.actor_id.
    actor: Optional[UserPublic] = None
    #: The first line or so of the comment, for `commented` and `mentioned`.
    #: Trimmed server-side so the inbox never downloads a 4,000-word comment
    #: to show forty characters of it.
    excerpt: Optional[str] = None
    #: For `field_assigned` (#117): the field the reader was named in --
    #: "Reviewer" -- as it is called now.
    field_name: Optional[str] = None
    #: For a due-date reminder (#262): the date it was about, which may not
    #: be the ticket's date any more.
    due_date: Optional[date] = None
    #: Whether the ticket is the reader's now. A reminder says so: "Due
    #: 4 Oct, and assigned to you."
    assigned_to_you: bool = False
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


class ChannelSetting(BaseModel):
    channel: NotificationChannel
    enabled: bool
    #: Cannot be switched off: being assigned or mentioned, in the app.
    locked: bool = False


class NotificationKindSetting(BaseModel):
    """One row of the grid: a registered kind, and where it reaches you."""

    kind: str
    #: In English, as registered. The page translates by `kind` and falls
    #: back to these, so a kind added later shows up named either way.
    name: str
    description: str
    #: Still arrives from a muted team.
    through_mute: bool
    #: One per column, in the order of `NotificationSettings.channels`.
    channels: list[ChannelSetting]


class TeamNotificationSetting(BaseModel):
    team_id: int
    key: str
    name: str
    muted: bool


class NotificationSettings(BaseModel):
    #: Whether this instance can send mail at all. Read-only. Without it the
    #: email column is not offered: a switch would promise mail that nothing
    #: is going to send.
    email_delivery_configured: bool
    #: The columns of the grid. Email only with a mail server.
    channels: list[NotificationChannel]
    #: The rows, drawn from `notification_kinds.KINDS`.
    kinds: list[NotificationKindSetting]
    #: The teams you are on, and which of them you have muted.
    teams: list[TeamNotificationSetting]


class KindPreferenceUpdate(BaseModel):
    kind: str
    channel: NotificationChannel
    enabled: bool


class TeamMuteUpdate(BaseModel):
    team_id: int
    muted: bool


class NotificationSettingsUpdate(BaseModel):
    """Any number of switches at once; the page sends one at a time."""

    preferences: list[KindPreferenceUpdate] = []
    teams: list[TeamMuteUpdate] = []
