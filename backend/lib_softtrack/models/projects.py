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
    #: Progress over the issues in the project, counted the way sub-issues
    #: count children: cancelled issues are left out of both numbers, so a
    #: project whose remaining work was cancelled can still reach 100%.
    #: No default, for the reason IssueRead's counts have none.
    issue_count: int
    completed_issue_count: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
