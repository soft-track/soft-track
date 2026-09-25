from typing import Optional

from pydantic import BaseModel

from lib_softtrack.models.issues import IssueRead


class IssueTransfer(BaseModel):
    """Where to move an issue (#98)."""

    team_id: int


class StatusChange(BaseModel):
    from_name: str
    to_name: str
    #: False when the target team has no status in the same category and the
    #: issue lands in its first column instead.
    same_category: bool


class TransferPlan(BaseModel):
    """What moving an issue to another team would change, before it does.

    The confirmation dialog shows this, and `transfer_issue` carries out the
    same plan -- they are computed by one function, so the summary a person
    agreed to is the change they get.
    """

    from_identifier: str
    #: The key it would get now. Another issue filed on the target team before
    #: the move is confirmed takes this number, so the move itself says which
    #: key it really got.
    to_identifier: str
    status: StatusChange
    labels_kept: list[str]
    labels_dropped: list[str]
    #: Names of what is cleared, or null when there was nothing to clear.
    cycle_cleared: Optional[str] = None
    project_cleared: Optional[str] = None
    #: The assignee, when they are not on the target team.
    assignee_cleared: Optional[str] = None
    #: The parent it leaves behind, when this is a sub-issue.
    parent_detached: Optional[str] = None
    #: Sub-issues that move with it, by current identifier.
    sub_issues: list[str]


class TransferResult(BaseModel):
    issue: IssueRead
    #: The sub-issues that moved with it, in their new team.
    sub_issues: list[IssueRead]
