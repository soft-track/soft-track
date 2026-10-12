from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from lib_identity.models.identity import UserPublic
from lib_softtrack.tables import EstimateUnit, TeamRole


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
    #: What a WIP limit means (#270): a warning, or a refusal; and whether
    #: sub-tickets count against it.
    wip_limits_hard: bool = False
    wip_counts_subtickets: bool = True
    #: What the team estimates in (#268): points, hours or both.
    estimate_unit: EstimateUnit = EstimateUnit.points
    #: Who can find the team (#259): whether it is in the team directory, and
    #: whether anybody signed in may join it without asking.
    listed: bool = True
    open_to_join: bool = False
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
    #: WIP limits (#270): refuse a move over one, and count sub-tickets.
    wip_limits_hard: Optional[bool] = None
    wip_counts_subtickets: Optional[bool] = None
    #: Points, hours or both (#268). Points is the default.
    estimate_unit: Optional[EstimateUnit] = None
    #: Who can find the team (#259). Listed is the default; open is not.
    listed: Optional[bool] = None
    open_to_join: Optional[bool] = None


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


class MyJoinRequest(BaseModel):
    """Your own request to join a team (#259), as the directory shows it."""

    id: int
    note: Optional[str] = None
    created_at: datetime
    #: When it runs out, as an invitation sent at the same moment would.
    expires_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TeamDirectoryEntry(BaseModel):
    """A team as somebody who is not on it sees it (#318, #259).

    Enough to know who to ask, and to ask: its name, its size and its admins.
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
    #: Anybody signed in joins it as a member without asking (#259).
    open_to_join: bool = False
    #: Your role on it, or null when you are not on it.
    my_role: Optional[TeamRole] = None
    #: Your request to join it still waiting, or null.
    my_request: Optional[MyJoinRequest] = None


class TeamDirectory(BaseModel):
    """The teams there are (#259): every listed team, the ones you are on, and
    the ones you have asked to join."""

    teams: list[TeamDirectoryEntry]
    #: How many teams in use keep themselves off the list, and are not yours.
    unlisted_count: int


#: Long enough for a sentence or two to the admins.
JOIN_NOTE_MAX = 500


class JoinRequestCreate(BaseModel):
    #: To the team's admins, in your own words. Optional.
    note: Optional[str] = Field(default=None, max_length=JOIN_NOTE_MAX)


class JoinRequestApprove(BaseModel):
    #: The role they join with. Somebody from outside the organisation is
    #: only ever a guest.
    role: TeamRole = TeamRole.member


class JoinRequestRead(BaseModel):
    """A request to join, as the team's admins see it (#259): who is asking,
    with their title, department and manager beside it, so the admin knows
    who they are."""

    id: int
    team_id: int
    requester: UserPublic
    job_title: Optional[str] = None
    department: Optional[str] = None
    manager: Optional[UserPublic] = None
    note: Optional[str] = None
    created_at: datetime
    expires_at: datetime


class TeamMemberRead(BaseModel):
    user: UserPublic
    role: TeamRole
    joined_at: datetime
    #: For an account from outside the organisation (#243), the epics it may
    #: see on this team; empty for everybody else, who sees them all.
    epics: list[EpicRef] = []
