import enum
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class PeopleUsage(BaseModel):
    """Accounts by state, and how many signed in lately (#312). Every account
    is in exactly one of the three states."""

    active: int
    #: Made by a site admin, and its owner has not chosen a password (#303).
    not_activated: int
    deactivated: int
    signed_in_last_7_days: int
    signed_in_last_30_days: int


class WeekCount(BaseModel):
    """Tickets created and closed in one week, Monday to Sunday, UTC."""

    week_of: date
    created: int
    #: Moved to a done or cancelled status from an open one, as the
    #: created-against-resolved report counts it.
    closed: int


class WorkUsage(BaseModel):
    #: Teams in use; archived ones are counted apart.
    teams: int
    archived_teams: int
    #: The last thirteen weeks, oldest first, this one last.
    weeks: list[WeekCount]


class FileKind(str, enum.Enum):
    """What a file is, from its type: all the page says of a file."""

    image = "image"
    video = "video"
    document = "document"
    text = "text"
    archive = "archive"
    other = "other"


class TeamStorage(BaseModel):
    team_id: int
    team_name: str
    size_bytes: int


class LargestFile(BaseModel):
    """One of the largest files: a kind, a team and a size. Never its name,
    which is content."""

    kind: FileKind
    team_id: int
    team_name: str
    size_bytes: int


class StorageUsage(BaseModel):
    """Attachment bytes, the trash included: they are stored until it is
    purged."""

    size_bytes: int
    files: int
    #: Teams with anything attached, the most first.
    teams: list[TeamStorage]
    largest: list[LargestFile]


class MailError(BaseModel):
    """What the mail server said the last time it refused a message."""

    at: datetime
    #: How many addresses the message was for. Never which.
    recipients: int
    error: str


class EmailUsage(BaseModel):
    #: Whether this instance has a mail server to send through at all.
    configured: bool
    sent: int
    failed: int
    #: The last failure in the week, or null when there was none.
    last_error: Optional[MailError] = None


class TeamWebhookFailures(BaseModel):
    """A team with outgoing webhooks, and how many of the deliveries in their
    logs failed every try."""

    team_id: int
    team_name: str
    failed: int


class TokenUsage(BaseModel):
    #: Not expired, and their owner's account is active. A revoked token is
    #: gone.
    live: int
    #: Live, and not used once since it was made.
    never_used: int


class UsageRead(BaseModel):
    """Administration -> Usage (#312): counts, and nothing of the content.
    Teams are named; no ticket, comment or file is."""

    people: PeopleUsage
    work: WorkUsage
    storage: StorageUsage
    email: EmailUsage
    #: Teams with outgoing webhooks, the most failures first.
    webhooks: list[TeamWebhookFailures]
    api_tokens: TokenUsage
