from typing import Optional

from pydantic import BaseModel

from lib_identity.models.identity import UserPublic


class StatusLoad(BaseModel):
    """The work sitting in one board column."""

    points: int
    ticket_count: int
    # Tickets in this column with no estimate. Reported rather than folded into
    # `points` as zero, because "nobody has sized these" and "these are free"
    # are different facts and a column of unsized work should look unfinished.
    unestimated_count: int
    #: What counts against the column's WIP limit (#270): `ticket_count`, or
    #: without its sub-tickets where the team does not count them.
    wip_count: int = 0


class AssigneeLoad(BaseModel):
    """What one person is carrying. `user` is null for unassigned work."""

    user: Optional[UserPublic] = None
    points: int
    ticket_count: int
    unestimated_count: int


class EstimateSummary(BaseModel):
    total_points: int
    total_tickets: int
    unestimated_tickets: int
    #: Keyed by status id as a string, because JSON object keys are
    #: strings and a numeric key would arrive as one anyway. Every one of
    #: the team's statuses is present, including the empty columns.
    by_status: dict[str, StatusLoad]
    by_assignee: list[AssigneeLoad]
