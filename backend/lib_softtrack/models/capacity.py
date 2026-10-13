"""Sprint capacity (#269): what each person can take, against what they have."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from lib_identity.models.identity import PersonRef
from lib_identity.models.people import SharedTeam
from lib_softtrack.models.time_estimates import MAX_ESTIMATE_MINUTES
from lib_softtrack.tables import EstimateUnit, SprintState

#: More points than one person takes in any sprint; a bound against typos.
MAX_CAPACITY_POINTS = 1000
#: A sprint is a few weeks; nobody is away for more working days than this.
MAX_DAYS_OFF = 366


class PlanSprint(BaseModel):
    """The sprint being planned, as the view's heading names it."""

    id: int
    display_name: str
    starts_at: datetime
    ends_at: datetime
    state: SprintState


class PersonCapacity(BaseModel):
    """One person's row: what is assigned to them in the sprint against what
    they can take.

    Capacity is the team's default in proportion to the days they are here,
    in each unit, unless somebody set it by hand for this sprint. Assigned
    counts every ticket in the sprint, done ones too: the plan is the whole
    sprint's.
    """

    person: PersonRef
    #: The sprint's working days, less the days they are away.
    days_here: int
    days_off: int
    tickets: int
    points_assigned: int
    points_capacity: int
    #: Whether `points_capacity` was set by hand for this sprint.
    points_set: bool
    #: The time estimates of their tickets in the sprint (#268), in minutes.
    minutes_assigned: int
    minutes_capacity: int
    minutes_set: bool


class SprintLoad(BaseModel):
    """Tickets in the sprint that are on nobody's plate -- or on the plate of
    somebody who has no capacity here."""

    tickets: int
    points: int
    minutes: int


class DeliveredSprint(BaseModel):
    """One of the last completed sprints: what it held when it started, and
    what was done in it."""

    sprint_id: int
    display_name: str
    points_planned: int
    points_delivered: int
    #: The time estimates of what was done, in minutes.
    minutes_delivered: int


class SprintPlan(BaseModel):
    """A sprint's plan (#269): a row per person who can be assigned the team's
    work, a row for what is unassigned, the sprint's scope beside its
    capacity, and the last three sprints as a line to plan against.

    Guests have no capacity and no row. Everything is in both units; the
    team's `estimate_unit` says which to show.
    """

    sprint: PlanSprint
    estimate_unit: EstimateUnit
    working_days: int
    #: The team's defaults the capacities start from.
    default_points: int
    default_minutes_per_day: int
    people: list[PersonCapacity]
    unassigned: SprintLoad
    #: Assigned to somebody who is no longer on the team, or is a guest now:
    #: in the scope, and in nobody's capacity.
    elsewhere: SprintLoad
    scope_points: int
    capacity_points: int
    scope_minutes: int
    capacity_minutes: int
    #: The last three completed sprints, oldest first.
    history: list[DeliveredSprint]
    #: Their average, rounded; null with no completed sprint to go on.
    average_points: Optional[int] = None
    average_minutes: Optional[int] = None


class CapacityChange(BaseModel):
    """One person's capacity in the sprint. A field left out is left as it
    is; a capacity sent as null goes back to the team's default."""

    user_id: int
    days_off: Optional[int] = Field(default=None, ge=0, le=MAX_DAYS_OFF)
    points: Optional[int] = Field(default=None, ge=0, le=MAX_CAPACITY_POINTS)
    minutes: Optional[int] = Field(default=None, ge=0, le=MAX_ESTIMATE_MINUTES)


class CapacityUpdate(BaseModel):
    people: list[CapacityChange] = Field(max_length=500)


class TeamCapacity(BaseModel):
    """Somebody's capacity on one team, in the sprint it is planning: what the
    workload tab shows for each team (#269)."""

    team: SharedTeam
    sprint_id: int
    sprint: str
    #: Which unit to read: hours for a team that estimates only in hours,
    #: points otherwise.
    unit: EstimateUnit
    points_assigned: int
    points_capacity: int
    minutes_assigned: int
    minutes_capacity: int
