from datetime import datetime
from typing import Optional

from pydantic import BaseModel, model_validator

from lib_softtrack.tables import SprintState


class SprintCreate(BaseModel):
    name: Optional[str] = None
    starts_at: datetime
    ends_at: datetime

    @model_validator(mode="after")
    def _ends_after_it_starts(self) -> "SprintCreate":
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class SprintUpdate(BaseModel):
    name: Optional[str] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None


class SprintProgress(BaseModel):
    """How much of the sprint's work is done.

    Issues and points are reported separately because they disagree, and the
    disagreement is the interesting part: eight of ten issues done with two
    points of thirty burned means the hard work is all still ahead.
    """

    issues_total: int
    issues_completed: int
    points_total: int
    points_completed: int
    #: Issues in the sprint carrying no estimate. Points totals are only as
    #: honest as this number is small.
    issues_unestimated: int


class SprintRead(BaseModel):
    id: int
    team_id: int
    number: int
    name: Optional[str] = None
    #: "Sprint 7" when unnamed, so a client never has to invent a label.
    display_name: str
    starts_at: datetime
    ends_at: datetime
    state: SprintState
    completed_at: Optional[datetime] = None
    progress: SprintProgress


class SprintCompletion(BaseModel):
    """The result of completing a sprint."""

    sprint: SprintRead
    #: Unfinished issues moved out of the completed sprint.
    carried_over: int
    #: Where they went: the next upcoming sprint, or null if they went back to
    #: the backlog because there was no sprint to carry them into.
    carried_into_sprint_id: Optional[int] = None
