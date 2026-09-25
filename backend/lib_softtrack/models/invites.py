from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr

from lib_identity.models.identity import UserPublic
from lib_softtrack.tables import TeamRole


class InviteCreate(BaseModel):
    email: EmailStr
    role: TeamRole = TeamRole.member
    #: Also email the link to `email` (#84). Off by default, so a client that
    #: has never heard of this gets exactly the copy-a-link flow it had. Only
    #: possible where SMTP is configured; asking elsewhere is a 400.
    send_email: bool = False


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
