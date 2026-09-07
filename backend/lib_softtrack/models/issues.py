from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.labels import LabelRead
from lib_softtrack.tables import IssuePriority, IssueStatus


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
    parent_id: Optional[int] = None
    label_ids: list[int] = []


class IssueUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    project_id: Optional[int] = None
    status: Optional[IssueStatus] = None
    priority: Optional[IssuePriority] = None
    assignee_id: Optional[int] = None
    #: An explicit null detaches the issue from its parent.
    parent_id: Optional[int] = None
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
    parent: Optional[ParentRef] = None
    #: Sub-issue progress, excluding cancelled children from both numbers.
    #: Zero of zero for an issue with no sub-issues.
    #:
    #: No defaults: every path that builds an IssueRead sets them, and
    #: defaulting them would make them optional in the schema, pushing an
    #: `undefined` check into every client that reads them.
    child_count: int
    completed_child_count: int
    creator: UserPublic
    labels: list[LabelRead] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
