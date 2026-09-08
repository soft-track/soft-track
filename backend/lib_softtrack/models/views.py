from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, model_validator

from lib_identity.models.identity import UserPublic
from lib_softtrack.tables import IssuePriority, IssueStatus


class ViewFilters(BaseModel):
    """What a view narrows the issue list to.

    Nested rather than flattened into the view models so that the same shape
    is what the board sends, what a view stores, and what the frontend keeps
    in the URL -- one type to keep in step instead of three.

    Null everywhere means "all issues", which is what an empty view is.
    """

    status: Optional[IssueStatus] = None
    priority: Optional[IssuePriority] = None
    assignee_id: Optional[int] = None
    #: "Nobody is assigned", which `assignee_id = null` does not say -- that
    #: means "anybody".
    unassigned: bool = False
    label_id: Optional[int] = None
    project_id: Optional[int] = None
    cycle_id: Optional[int] = None

    @model_validator(mode="after")
    def _one_assignee_question_at_a_time(self) -> "ViewFilters":
        if self.unassigned and self.assignee_id is not None:
            raise ValueError(
                "A view filters on an assignee or on being unassigned, not both."
            )
        return self


class SavedViewCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    is_shared: bool = False
    filters: ViewFilters = ViewFilters()


class SavedViewUpdate(BaseModel):
    """Every field optional: renaming, re-filtering and sharing are separate
    gestures in the UI and each sends only what it changed."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    is_shared: Optional[bool] = None
    filters: Optional[ViewFilters] = None


class SavedViewRead(BaseModel):
    id: int
    team_id: int
    name: str
    owner: UserPublic
    is_shared: bool
    filters: ViewFilters
    created_at: datetime
    updated_at: datetime


class SavedViews(BaseModel):
    """The whole sidebar in one response.

    The defaults come back with the list rather than from their own endpoint
    because the sidebar cannot render a row without knowing whether it is
    starred, and a second request would mean a frame where none of them are.
    """

    items: list[SavedViewRead]
    #: The team's default, set by an admin. Null when nobody has set one.
    team_default_id: Optional[int] = None
    #: This user's own override, if they have chosen one.
    my_default_id: Optional[int] = None
    #: What the board should actually open on: the override, else the team's.
    #: Resolved here so the client is not reimplementing the precedence rule.
    effective_default_id: Optional[int] = None


class DefaultViewUpdate(BaseModel):
    """Null clears the default rather than setting one."""

    view_id: Optional[int] = None
