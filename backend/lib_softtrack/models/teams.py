from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

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
    #: Whether any member may delete any ticket or epic, or only its creator
    #: -- an epic's lead -- and the team's admins (#323).
    any_member_may_delete: bool = False
    #: Whether the team's guests may comment, react and attach files to their
    #: comments (#244).
    guests_may_comment: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TeamUpdate(BaseModel):
    """What an admin may change about a team.

    No `key`: identifiers like ENG-42 are already in commit messages, chat
    logs and browser history, and renaming the prefix would strand every one
    of them. See README.
    """

    name: Optional[str] = None
    description: Optional[str] = None
    #: Who may delete (#323): any member, or only a ticket's creator -- an
    #: epic's lead -- and the team's admins.
    any_member_may_delete: Optional[bool] = None
    #: Let the team's guests comment (#244). Off for every team until an admin
    #: turns it on.
    guests_may_comment: Optional[bool] = None


class EpicRef(BaseModel):
    """An epic as a roster names it: an outside account's reach (#243)."""

    id: int
    name: str
    color: str

    model_config = ConfigDict(from_attributes=True)


class TeamMemberAdd(BaseModel):
    email: EmailStr
    role: TeamRole = TeamRole.member
    #: For an account from outside the organisation (#243), which joins as a
    #: guest: the epics of this team it may see. None means no tickets.
    epic_ids: list[int] = []


class TeamMemberUpdate(BaseModel):
    #: Left out, the role stays as it is.
    role: Optional[TeamRole] = None
    #: Who takes the open tickets of somebody made a guest, who may not hold
    #: any (#316). Left out, they are unassigned. Ignored for other changes.
    reassign_to: Optional[int] = None
    #: The epics an account from outside may see (#243), all of them: the
    #: list replaces the one there was. Left out, they stay as they are.
    epic_ids: Optional[list[int]] = None


class TeamDirectoryEntry(BaseModel):
    """A team as somebody who is not on it sees it (#318).

    Enough to know who to ask to be added: its name, its size and its admins.
    Nothing of its work -- no tickets, epics or sprints -- which still takes
    being on the team.
    """

    id: int
    name: str
    key: str
    description: Optional[str] = None
    #: Everybody on it with an active account, guests included.
    member_count: int
    #: Its active admins, longest-serving first.
    admins: list[UserPublic]


class TeamMemberRead(BaseModel):
    user: UserPublic
    role: TeamRole
    joined_at: datetime
    #: For an account from outside the organisation (#243), the epics it may
    #: see on this team; empty for everybody else, who sees them all.
    epics: list[EpicRef] = []
