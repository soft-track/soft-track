from datetime import datetime
from typing import Optional

from pydantic import BaseModel, model_validator

from lib_softtrack.tables import CycleState


class CycleCreate(BaseModel):
    name: Optional[str] = None
    starts_at: datetime
    ends_at: datetime

    @model_validator(mode="after")
    def _ends_after_it_starts(self) -> "CycleCreate":
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class CycleUpdate(BaseModel):
    name: Optional[str] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None


class CycleProgress(BaseModel):
    """How much of the cycle's work is done.

    Issues and points are reported separately because they disagree, and the
    disagreement is the interesting part: eight of ten issues done with two
    points of thirty burned means the hard work is all still ahead.
    """

    issues_total: int
    issues_completed: int
    points_total: int
    points_completed: int
    #: Issues in the cycle carrying no estimate. Points totals are only as
    #: honest as this number is small.
    issues_unestimated: int


class CycleRead(BaseModel):
    id: int
    team_id: int
    number: int
    name: Optional[str] = None
    #: "Cycle 7" when unnamed, so a client never has to invent a label.
    display_name: str
    starts_at: datetime
    ends_at: datetime
    state: CycleState
    completed_at: Optional[datetime] = None
    progress: CycleProgress


class CycleCompletion(BaseModel):
    """The result of completing a cycle."""

    cycle: CycleRead
    #: Unfinished issues moved out of the completed cycle.
    carried_over: int
    #: Where they went: the next upcoming cycle, or null if they went back to
    #: the backlog because there was no cycle to carry them into.
    carried_into_cycle_id: Optional[int] = None
