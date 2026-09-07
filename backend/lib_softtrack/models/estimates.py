from typing import Optional

from pydantic import BaseModel

from lib_identity.models.identity import UserPublic
from lib_softtrack.tables import IssueStatus


class StatusLoad(BaseModel):
    """The work sitting in one board column."""

    points: int
    issue_count: int
    # Issues in this column with no estimate. Reported rather than folded into
    # `points` as zero, because "nobody has sized these" and "these are free"
    # are different facts and a column of unsized work should look unfinished.
    unestimated_count: int


class AssigneeLoad(BaseModel):
    """What one person is carrying. `user` is null for unassigned work."""

    user: Optional[UserPublic] = None
    points: int
    issue_count: int
    unestimated_count: int


class EstimateSummary(BaseModel):
    total_points: int
    total_issues: int
    unestimated_issues: int
    by_status: dict[IssueStatus, StatusLoad]
    by_assignee: list[AssigneeLoad]
