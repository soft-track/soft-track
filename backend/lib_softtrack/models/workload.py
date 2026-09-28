from typing import Optional

from pydantic import BaseModel

from lib_identity.models.identity import PersonRef
from lib_identity.models.people import SharedTeam
from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.tables import TicketPriority


class WorkloadTicket(BaseModel):
    """One open ticket on somebody's plate (#127), as a planner scans it."""

    id: int
    team_key: str
    number: int
    identifier: str
    title: str
    status: StatusRead
    priority: TicketPriority
    estimate: Optional[int] = None
    #: The sprint's display name -- "Sprint 14" when it has no name of its
    #: own -- or null for a ticket in no sprint.
    sprint: Optional[str] = None


class WorkloadTeam(BaseModel):
    """One team's share of somebody's open work, and a page of it."""

    team: SharedTeam
    #: Counted and summed by the database across the whole team, not the
    #: page: the way sprint rollups are, so the total is never "of whatever
    #: happened to load".
    open_count: int
    points: int
    #: Started first, then unstarted, then the backlog; most urgent first
    #: within each.
    tickets: list[WorkloadTicket]
    offset: int
    limit: int


class ReportLoad(BaseModel):
    """A direct report's open work, in the same teams-you-share terms."""

    person: PersonRef
    open_count: int
    points: int


class WorkloadRead(BaseModel):
    """Everything open assigned to one person, in the teams the viewer is on.

    Tenancy is inside the query: a ticket is here only if it is assigned to
    them *and* on a team the viewer belongs to. A site admin gets no wider
    view -- this is for planning, not auditing.
    """

    open_count: int
    points: int
    teams: list[WorkloadTeam]
    #: Each of their direct reports and how much is open for them -- what a
    #: manager's profile shows beside each name. Empty when a single team's
    #: page was asked for.
    reports: list[ReportLoad]
