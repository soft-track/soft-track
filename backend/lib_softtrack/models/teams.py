from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field

from lib_identity.models.identity import UserPublic
from lib_softtrack.tables import TeamRole


class TeamCreate(BaseModel):
    name: str
    key: str = Field(min_length=2, max_length=6, description="Short prefix, e.g. ENG")
    description: Optional[str] = None


class TeamRead(BaseModel):
    id: int
    name: str
    key: str
    description: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class TeamUpdate(BaseModel):
    """What an admin may change about a team.

    No `key`: identifiers like ENG-42 are already in commit messages, chat
    logs and browser history, and renaming the prefix would strand every one
    of them. See README.
    """

    name: Optional[str] = None
    description: Optional[str] = None


class TeamMemberAdd(BaseModel):
    email: EmailStr
    role: TeamRole = TeamRole.member


class TeamMemberUpdate(BaseModel):
    role: TeamRole


class TeamMemberRead(BaseModel):
    user: UserPublic
    role: TeamRole
    joined_at: datetime
