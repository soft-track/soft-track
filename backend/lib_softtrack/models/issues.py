from datetime import datetime
from typing import Annotated, Optional

from pydantic import AfterValidator, BaseModel, Field

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.labels import LabelRead
from lib_softtrack.tables import IssuePriority, IssueStatus

# A modified Fibonacci scale. The gaps are the point: they stop a team
# arguing about whether something is a 6 or a 7, a distinction no estimate is
# accurate enough to carry.
ESTIMATE_SCALE = (1, 2, 3, 5, 8)


def _on_the_scale(value: Optional[int]) -> Optional[int]:
    """Reject an estimate that is not on the scale.

    An explicit check rather than a `Literal` so the error names the scale: a
    422 reading "estimate must be null or one of 1, 2, 3, 5, 8" is actionable
    where pydantic's default union error is not.
    """
    if value is None or value in ESTIMATE_SCALE:
        return value
    allowed = ", ".join(str(point) for point in ESTIMATE_SCALE)
    raise ValueError(f"estimate must be null or one of {allowed}; got {value}")


Estimate = Annotated[
    Optional[int],
    AfterValidator(_on_the_scale),
    Field(
        json_schema_extra={"enum": [None, *ESTIMATE_SCALE]},
        description=(
            "Story points on the scale 1, 2, 3, 5, 8. Null means not sized "
            "yet, which is distinct from an estimate of zero."
        ),
    ),
]


class ParentRef(BaseModel):
    """Just enough of the parent to render a breadcrumb."""

    id: int
    identifier: str
    title: str


class IssueCreate(BaseModel):
    title: str
    description: Optional[str] = None
    project_id: Optional[int] = None
    status: IssueStatus = IssueStatus.backlog
    priority: IssuePriority = IssuePriority.no_priority
    assignee_id: Optional[int] = None
    estimate: Estimate = None
    parent_id: Optional[int] = None
    cycle_id: Optional[int] = None
    label_ids: list[int] = []


class IssueUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    project_id: Optional[int] = None
    status: Optional[IssueStatus] = None
    priority: Optional[IssuePriority] = None
    assignee_id: Optional[int] = None
    # `exclude_unset` in the service keeps "clear the estimate" (an explicit
    # null) distinct from "leave it alone" (the field omitted). The same
    # applies to parent_id below.
    estimate: Estimate = None
    #: An explicit null detaches the issue from its parent.
    parent_id: Optional[int] = None
    #: An explicit null moves the issue out of its cycle, back to the backlog.
    cycle_id: Optional[int] = None
    label_ids: Optional[list[int]] = None


class IssueRead(BaseModel):
    id: int
    team_id: int
    project_id: Optional[int] = None
    number: int
    identifier: str
    title: str
    description: Optional[str] = None
    status: IssueStatus
    priority: IssuePriority
    assignee: Optional[UserPublic] = None
    estimate: Optional[int] = None
    #: Unresolved issues that block this one. Zero for an issue that is free
    #: to start; the board marks anything above zero.
    blocked_by_count: int
    cycle_id: Optional[int] = None
    #: The key this issue had before it was imported, e.g. "PROJ-142".
    external_key: Optional[str] = None
    parent: Optional[ParentRef] = None
    #: Sub-issue progress, excluding cancelled children from both numbers.
    #: Zero of zero for an issue with no sub-issues.
    child_count: int
    completed_child_count: int
    #: None of the three counts above carry a default. Every path that builds
    #: an IssueRead sets them, and defaulting them would make them optional in
    #: the schema, pushing an `undefined` check into every client.
    creator: UserPublic
    labels: list[LabelRead] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
