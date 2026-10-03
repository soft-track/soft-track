from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from lib_softtrack.tables import SprintOutcome, SprintState


class SprintCreate(BaseModel):
    name: Optional[str] = None
    starts_at: datetime
    ends_at: datetime
    #: What the sprint is for (#271): a sentence or two.
    goal: Optional[str] = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _ends_after_it_starts(self) -> "SprintCreate":
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class SprintUpdate(BaseModel):
    name: Optional[str] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    goal: Optional[str] = Field(default=None, max_length=500)


class RetroActionRead(BaseModel):
    """A line from "what to change" that became a ticket (#271)."""

    id: int
    text: str
    ticket_id: int
    #: "ENG-41", to show beside the line.
    identifier: str
    created_at: datetime


class Retrospective(BaseModel):
    """What the team learned from a sprint (#271): three markdown sections,
    any of them empty until somebody writes it."""

    went_well: Optional[str] = None
    did_not: Optional[str] = None
    to_change: Optional[str] = None
    #: When a team admin closed it to further writing; null while open.
    closed_at: Optional[datetime] = None
    actions: list[RetroActionRead] = []


class RetrospectiveUpdate(BaseModel):
    """Writing to a completed sprint's retrospective. Fields left out stay as
    they are; an explicit null clears one."""

    outcome: Optional[SprintOutcome] = None
    went_well: Optional[str] = Field(default=None, max_length=20_000)
    did_not: Optional[str] = Field(default=None, max_length=20_000)
    to_change: Optional[str] = Field(default=None, max_length=20_000)


class SprintCompleteRequest(BaseModel):
    """What completing a sprint asks as well (#271), all of it optional: the
    retrospective can be written later."""

    outcome: Optional[SprintOutcome] = None
    went_well: Optional[str] = Field(default=None, max_length=20_000)
    did_not: Optional[str] = Field(default=None, max_length=20_000)
    to_change: Optional[str] = Field(default=None, max_length=20_000)


class RetroActionCreate(BaseModel):
    """A line from "what to change", to make a ticket of."""

    text: str = Field(min_length=1, max_length=500)


class SprintProgress(BaseModel):
    """How much of the sprint's work is done.

    Tickets and points are reported separately because they disagree, and the
    disagreement is the interesting part: eight of ten tickets done with two
    points of thirty burned means the hard work is all still ahead.
    """

    tickets_total: int
    tickets_completed: int
    points_total: int
    points_completed: int
    #: Tickets in the sprint carrying no estimate. Points totals are only as
    #: honest as this number is small.
    tickets_unestimated: int


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
    #: What it is for, and whether that was met (#271). The outcome is said
    #: when the sprint is completed, or afterwards.
    goal: Optional[str] = None
    goal_outcome: Optional[SprintOutcome] = None
    #: A completed sprint's retrospective; null before it is completed.
    retrospective: Optional[Retrospective] = None


class SprintCompletion(BaseModel):
    """The result of completing a sprint."""

    sprint: SprintRead
    #: Unfinished tickets moved out of the completed sprint.
    carried_over: int
    #: Where they went: the next upcoming sprint, or null if they went back to
    #: the backlog because there was no sprint to carry them into.
    carried_into_sprint_id: Optional[int] = None
