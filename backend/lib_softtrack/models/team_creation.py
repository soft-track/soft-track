"""Who may create teams, and asking for one (#306)."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from lib_identity.models.identity import UserPublic
from lib_softtrack.tables import TeamCreationPolicy, TeamRequestState

#: Long enough to say what the team is for, short enough to read in a row.
REASON_MAX = 500


class TeamRequestCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    key: str = Field(min_length=2, max_length=6, description="Short prefix, e.g. BRD")
    #: What the team is for, which is what the site admins decide on.
    reason: str = Field(min_length=1, max_length=REASON_MAX)


class TeamRequestRead(BaseModel):
    id: int
    requester: UserPublic
    name: str
    key: str
    reason: str
    state: TeamRequestState
    created_at: datetime
    decided_at: Optional[datetime] = None
    decline_reason: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class TeamRequestDecline(BaseModel):
    #: Told to the person who asked. Optional.
    reason: Optional[str] = Field(default=None, max_length=REASON_MAX)


class TeamCreationAccess(BaseModel):
    """What the signed-in person may do about creating a team.

    What the sidebar, the new-team page and the page for somebody with no
    team read to offer "New team", or to say who to ask instead.
    """

    may_create: bool
    policy: TeamCreationPolicy
    #: Who decides requests for a team, and so who to ask. Empty for somebody
    #: who may create one.
    site_admins: list[UserPublic]
    #: Their own requests still waiting for a decision.
    pending_requests: list[TeamRequestRead]


class TeamCreationSettings(BaseModel):
    """The instance setting, as a site admin sees it."""

    policy: TeamCreationPolicy
    #: Set as TEAM_CREATION in the environment, which wins: the policy is
    #: shown, and cannot be changed in the app. The named people still can.
    from_environment: bool
    named_people: list[UserPublic]
    #: Requests waiting for a decision, oldest first.
    requests: list[TeamRequestRead]


class TeamCreationUpdate(BaseModel):
    policy: TeamCreationPolicy
    #: Everybody named, replacing the list. Kept whatever the policy.
    named_people_ids: list[int] = []
