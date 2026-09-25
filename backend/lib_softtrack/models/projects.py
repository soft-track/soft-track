from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from lib_softtrack.tables import ProjectState


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1)
    description: Optional[str] = None
    color: str = "#6366f1"
    lead_id: Optional[int] = None
    target_date: Optional[date] = None
    state: ProjectState = ProjectState.planned


class ProjectUpdate(BaseModel):
    """Every field optional: renaming, retiring and re-dating are separate
    gestures and each sends only what it changed. Send `lead_id` or
    `target_date` as null to clear it."""

    name: Optional[str] = Field(default=None, min_length=1)
    description: Optional[str] = None
    color: Optional[str] = None
    lead_id: Optional[int] = None
    target_date: Optional[date] = None
    state: Optional[ProjectState] = None
    archived: Optional[bool] = None


class ProjectRead(BaseModel):
    id: int
    team_id: int
    name: str
    description: Optional[str] = None
    color: str
    lead_id: Optional[int] = None
    target_date: Optional[date] = None
    state: ProjectState
    archived: bool
    created_at: datetime
    #: Progress, counted the way sub-issues are (#13): cancelled issues are in
    #: neither number, so "4 of 6" cannot be made unreachable by cancelling
    #: work. Zero of zero for a project with nothing in it. No defaults, for
    #: the reason IssueRead gives for its own counts.
    issue_count: int
    completed_issue_count: int

    model_config = ConfigDict(from_attributes=True)
