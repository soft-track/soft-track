from datetime import datetime

from pydantic import BaseModel, EmailStr

from lib_identity.models.identity import UserPublic
from lib_softtrack.tables import TeamRole


class InviteCreate(BaseModel):
    email: EmailStr
    role: TeamRole = TeamRole.member


class InviteRead(BaseModel):
    """A pending invitation, as an admin of the team (or its recipient) sees it.

    Carries the token because there is no mail server: the link is copied out
    of this response and sent by whatever the team already uses. Only ever
    returned to a team admin or to the person the invite is addressed to.
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
