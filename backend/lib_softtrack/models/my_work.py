import enum
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel

from lib_identity.models.identity import PersonRef
from lib_identity.models.people import SharedTeam
from lib_softtrack.models.invites import InviteRead
from lib_softtrack.models.page import Page
from lib_softtrack.models.teams import EpicRef
from lib_softtrack.models.workload import WorkloadTicket
from lib_softtrack.tables import TicketEventField, TicketType


class MyWorkTab(str, enum.Enum):
    """Whose tickets: the three tabs of My work (#258)."""

    assigned = "assigned"
    watching = "watching"
    created = "created"


class MyWorkGrouping(str, enum.Enum):
    """By team, each with its totals, or as one list."""

    team = "team"
    none = "none"


class ActivityKind(str, enum.Enum):
    created = "created"
    commented = "commented"
    changed = "changed"


class LastActivity(BaseModel):
    """What last happened on a watched ticket: a comment, a change to one of
    the fields its history records, or -- with neither -- its creation."""

    kind: ActivityKind
    #: Which field changed, for `changed`.
    field: Optional[TicketEventField] = None
    #: The name it was given, where the value is somebody: who it was
    #: assigned to. Null for anything else, and for "unassigned".
    new_label: Optional[str] = None
    #: Null for an automation rule.
    actor: Optional[PersonRef] = None
    at: datetime


class MyWorkTicket(WorkloadTicket):
    """A row of My work: the workload's ticket, and what the row shows
    beside it -- its type, its epic and when it is due."""

    type: TicketType
    due_date: Optional[date] = None
    project: Optional[EpicRef] = None
    #: On the Watching tab only.
    last_activity: Optional[LastActivity] = None


class MyWorkTeam(BaseModel):
    """One team's share, as the workload tab groups it."""

    team: SharedTeam
    #: The team's whole count and points, from the database, due soon included.
    open_count: int
    points: int
    #: How many of them are listed in this group: the count less those pulled
    #: up into "due soon". What "Show more" pages through.
    listed_count: int
    tickets: list[MyWorkTicket]
    offset: int
    limit: int


class MyWorkCounts(BaseModel):
    """The number beside each tab."""

    assigned: int
    watching: int
    created: int


class WaitingJoinRequest(BaseModel):
    """Somebody asking to join a team the viewer is an admin of (#259)."""

    id: int
    team: SharedTeam
    requester: PersonRef
    created_at: datetime


class WaitingOnMe(BaseModel):
    """What only the viewer can move: invitations to them, and requests to
    join their teams. The approvals of #248 and #296 join it as they ship."""

    invites: list[InviteRead]
    join_requests: list[WaitingJoinRequest]


class MyWorkRead(BaseModel):
    """My work (#258): the open tickets that are the viewer's, across every
    team they are on.

    Confined the way everything is: tickets in the trash are not here, an
    account from outside sees only its epics, and a team the viewer is not on
    -- or one a site admin archived -- is neither listed nor counted.
    """

    tab: MyWorkTab
    grouping: MyWorkGrouping
    counts: MyWorkCounts
    #: Overdue, or due in the next few days, pulled to the top whatever the
    #: grouping and left out of it: Assigned to me only, empty on the others.
    due: list[MyWorkTicket]
    #: By team: one group per team, each with a page. Empty as one list.
    teams: list[MyWorkTeam]
    #: As one list: a page of it. Null by team.
    tickets: Optional[Page[MyWorkTicket]] = None
    waiting: WaitingOnMe
