from datetime import date
from typing import Optional

from pydantic import BaseModel

from lib_softtrack.tables import IssueStatus


class BurndownPoint(BaseModel):
    day: date
    #: Points still outstanding at the end of this day.
    points_remaining: int
    issues_remaining: int
    #: Points completed so far -- the burnup line, from the same data.
    points_completed: int
    #: Total points in the cycle on this day. It moves when scope changes,
    #: which is exactly what makes a burndown honest.
    points_total: int
    #: The straight line from the cycle's opening scope to zero. Not a target
    #: so much as the thing the real line is read against.
    ideal_remaining: float


class ScopeChange(BaseModel):
    day: date
    issues_added: int
    issues_removed: int
    points_added: int
    points_removed: int


class Burndown(BaseModel):
    cycle_id: int
    cycle_name: str
    starts_at: date
    ends_at: date
    points: list[BurndownPoint]
    #: Only the days on which scope actually moved, so a chart can mark them.
    scope_changes: list[ScopeChange]


class VelocityCycle(BaseModel):
    cycle_id: int
    cycle_name: str
    completed_at: Optional[date] = None
    points_committed: int
    points_completed: int
    issues_completed: int


class Velocity(BaseModel):
    cycles: list[VelocityCycle]
    #: Mean completed points across the cycles returned. Null when there are
    #: none -- a zero would read as "this team delivers nothing".
    average_points: Optional[float] = None


class FlowPoint(BaseModel):
    day: date
    counts: dict[IssueStatus, int]


class CumulativeFlow(BaseModel):
    days: list[FlowPoint]


class CreatedResolvedPoint(BaseModel):
    day: date
    created: int
    resolved: int
    #: Running total of created minus resolved: the backlog line.
    open_at_end_of_day: int


class CreatedVsResolved(BaseModel):
    days: list[CreatedResolvedPoint]
    total_created: int
    total_resolved: int
