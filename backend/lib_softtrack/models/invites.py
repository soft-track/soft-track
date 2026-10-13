from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, EmailStr, Field

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.teams import EpicRef
from lib_softtrack.tables import TeamRole


class InviteCreate(BaseModel):
    email: EmailStr
    role: TeamRole = TeamRole.member
    #: Also email the link to `email` (#84). Off by default, so a client that
    #: has never heard of this gets exactly the copy-a-link flow it had. Only
    #: possible where SMTP is configured; asking elsewhere is a 400.
    send_email: bool = False
    #: Somebody from outside the organisation (#243): the account is external,
    #: joins as a guest, and sees the tickets of `epic_ids` and nothing else.
    external: bool = False
    #: The epics of this team they may see. None chosen means no tickets.
    epic_ids: list[int] = []


class InviteRead(BaseModel):
    """A pending invitation, as an admin of the team (or its recipient) sees it.

    Carries the token so the link can be copied out of this response and sent
    by whatever the team already uses -- which works on every instance, with
    or without a mail server. Only ever returned to a team admin or to the
    person the invite is addressed to.
    """

    id: int
    team_id: int
    team_name: str
    team_key: str
    email: str
    role: TeamRole
    token: str
    invited_by: UserPublic
    created_at: datetime
    expires_at: datetime
    #: When this link was emailed to `email`, if it was.
    emailed_at: Optional[datetime] = None
    #: For somebody from outside (#243), and the epics they will see.
    external: bool = False
    epics: list[EpicRef] = []


class InvitePreview(BaseModel):
    """What the invite link shows to someone who is not signed in yet.

    Deliberately thin. Anyone holding the link can read it, so it says enough
    to decide whether to accept -- which team, from whom, as what -- and
    nothing about the team's contents or its other members.
    """

    team_name: str
    team_key: str
    email: str
    role: TeamRole
    invited_by_name: str
    expires_at: datetime


class BulkInviteCreate(BaseModel):
    """Many addresses, one role, one or more teams (#304)."""

    #: As pasted: addresses separated by commas, spaces or new lines.
    #: "Name <address>" is understood.
    addresses: str = Field(max_length=50_000)
    role: TeamRole = TeamRole.member
    #: The teams to invite to, each one the caller administers. Empty means
    #: the team in the path.
    team_ids: list[int] = []
    #: Email each link as well (#84). Only where SMTP is configured.
    send_email: bool = False
    #: Create an account for each address that has none, and put everybody
    #: on the teams directly instead of inviting them (#303). Site admins only.
    create_accounts: bool = False
    #: Say what would happen to each address, and change nothing.
    preview: bool = False


class BulkInviteKind(str, Enum):
    #: A new invitation.
    invite = "invite"
    #: A live invitation already, which gets a fresh link.
    fresh_link = "fresh_link"
    #: On the team already: skipped.
    member = "member"
    #: An account already, put on the team directly (`create_accounts`).
    add = "add"
    #: A new account, put on the team (`create_accounts`).
    account = "account"
    #: Refused, for `reason`.
    refused = "refused"


class BulkInviteStatus(str, Enum):
    sent = "sent"
    skipped = "skipped"
    failed = "failed"


class BulkInviteTeamResult(BaseModel):
    """What happens to one address on one team."""

    team_id: int
    team_name: str
    kind: BulkInviteKind
    #: Unset on a preview, where nothing has happened yet.
    status: Optional[BulkInviteStatus] = None
    #: Why it was skipped or failed: an `ErrorCode`, or "mail_refused" when
    #: the invitation was made but the mail server would not take it.
    reason: Optional[str] = None
    detail: Optional[str] = None
    #: The invitation, with the link to copy.
    invite: Optional[InviteRead] = None


class BulkInviteEntry(BaseModel):
    """One address as pasted, and what happens to it on each team."""

    #: The line it was on, counting from 1.
    line: int
    #: As pasted.
    text: str
    #: Lower-cased; null for a line that is not an address.
    email: Optional[str] = None
    #: The account's name where there is one, else the name pasted with it.
    name: Optional[str] = None
    is_address: bool = True
    teams: list[BulkInviteTeamResult] = []
    #: The link a new account's owner chooses a password from (#303). The
    #: only time it is shown.
    welcome_link: Optional[str] = None


class BulkInviteResult(BaseModel):
    """A result per address, and the totals. On a preview the totals are
    zero: nothing has been sent."""

    preview: bool
    entries: list[BulkInviteEntry]
    #: Per address and team; a line that is not an address counts once.
    sent: int = 0
    skipped: int = 0
    failed: int = 0
