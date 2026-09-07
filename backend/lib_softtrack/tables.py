"""SQLModel table definitions and the enums that describe their columns.

The Educare backend has no direct counterpart to this module because it talks to
the database in raw SQL. Here the tables *are* the schema, so they live in one
place under `lib_softtrack` and are imported by both the identity and product
service layers.
"""

import enum
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import SQLModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class IssueStatus(str, enum.Enum):
    backlog = "backlog"
    todo = "todo"
    in_progress = "in_progress"
    in_review = "in_review"
    done = "done"
    cancelled = "cancelled"


class IssuePriority(str, enum.Enum):
    no_priority = "no_priority"
    urgent = "urgent"
    high = "high"
    medium = "medium"
    low = "low"


class IssueLinkType(str, enum.Enum):
    """How one issue relates to another.

    Only three are stored. "Blocked by" and "duplicated by" are not types --
    they are the same rows read from the other end, which is what keeps the
    two issues from ever disagreeing about their relationship.

    `relates_to` is symmetric, so it is stored once and shown identically on
    both issues.
    """

    blocks = "blocks"
    relates_to = "relates_to"
    duplicates = "duplicates"


#: The types where direction carries meaning, and so where the same pair
#: cannot be linked both ways round.
DIRECTED_LINK_TYPES = (IssueLinkType.blocks, IssueLinkType.duplicates)


class CycleState(str, enum.Enum):
    """Where a cycle is in its life.

    Derived from dates would be simpler, but a team that forgets to start a
    cycle on Monday should not have Monday counted against its burndown, and a
    cycle that runs a day long should not silently complete itself and carry
    work away. So the state is set deliberately and the dates are the plan.
    """

    upcoming = "upcoming"
    active = "active"
    completed = "completed"


class IssueEventField(str, enum.Enum):
    """Which field an IssueEvent records a change to."""

    status = "status"
    cycle = "cycle"
    estimate = "estimate"


class TeamRole(str, enum.Enum):
    admin = "admin"
    member = "member"


# ---------------------------------------------------------------------------
# Link tables
# ---------------------------------------------------------------------------


class TeamMember(SQLModel, table=True):
    team_id: int = Field(foreign_key="team.id", primary_key=True)
    user_id: int = Field(foreign_key="user.id", primary_key=True)
    role: TeamRole = Field(default=TeamRole.member)
    joined_at: datetime = Field(default_factory=utcnow)


class IssueLabelLink(SQLModel, table=True):
    issue_id: int = Field(foreign_key="issue.id", primary_key=True)
    label_id: int = Field(foreign_key="label.id", primary_key=True)


# ---------------------------------------------------------------------------
# Core tables
# ---------------------------------------------------------------------------


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    hashed_password: str
    full_name: str
    avatar_color: str = Field(default="#6366f1")
    created_at: datetime = Field(default_factory=utcnow)


class Team(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    key: str = Field(index=True, unique=True, description="Short prefix, e.g. ENG")
    description: Optional[str] = None
    next_issue_number: int = Field(default=1)
    next_cycle_number: int = Field(default=1)
    created_at: datetime = Field(default_factory=utcnow)


class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    name: str
    description: Optional[str] = None
    color: str = Field(default="#6366f1")
    created_at: datetime = Field(default_factory=utcnow)


class Label(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    name: str
    color: str = Field(default="#94a3b8")


class Issue(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    project_id: Optional[int] = Field(
        default=None, foreign_key="project.id", index=True
    )
    number: int
    title: str
    description: Optional[str] = None
    status: IssueStatus = Field(default=IssueStatus.backlog, index=True)
    priority: IssuePriority = Field(default=IssuePriority.no_priority)
    assignee_id: Optional[int] = Field(default=None, foreign_key="user.id")
    # One level of nesting only -- an issue with a parent may not itself be a
    # parent. See lib_softtrack/subissues.py for why that limit is enforced
    # rather than left to convention.
    parent_id: Optional[int] = Field(default=None, foreign_key="issue.id", index=True)
    cycle_id: Optional[int] = Field(default=None, foreign_key="cycle.id", index=True)
    creator_id: int = Field(foreign_key="user.id")
    # Story points. Null means "not sized yet", which is a different thing
    # from zero -- a burndown has to be able to tell them apart.
    estimate: Optional[int] = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class IssueLink(SQLModel, table=True):
    """A relationship between two issues, stored once and read from both ends.

    The unique constraint is what enforces "no duplicate links" -- doing it in
    the database rather than only in the service means two simultaneous
    requests cannot both pass a check-then-insert and create a pair of
    identical rows.
    """

    __table_args__ = (
        UniqueConstraint("source_id", "target_id", "type", name="uq_issue_link"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    source_id: int = Field(foreign_key="issue.id", index=True)
    target_id: int = Field(foreign_key="issue.id", index=True)
    type: IssueLinkType
    created_by_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)


class Cycle(SQLModel, table=True):
    """A time-boxed iteration belonging to one team."""

    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: int = Field(foreign_key="team.id", index=True)
    #: Per team, and stable: "Cycle 7" keeps meaning the same fortnight after
    #: another cycle is deleted, which a positional index would not.
    number: int
    name: Optional[str] = None
    starts_at: datetime
    ends_at: datetime
    state: CycleState = Field(default=CycleState.upcoming, index=True)
    completed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)


class IssueEvent(SQLModel, table=True):
    """One recorded change to an issue field.

    This table is why reporting is possible at all. A burndown asks what the
    board looked like on the ninth of the month, and no amount of querying the
    current rows can answer that -- the history is simply gone unless it was
    written down as it happened. Every day this table does not exist is a day
    that can never be charted.

    Deliberately generic (field/old/new as text) rather than one table per
    field. The alternative is a new table and a new migration every time
    something else turns out to be worth charting, and the read patterns --
    "changes to this issue, in order" -- are identical whatever the field.
    """

    id: Optional[int] = Field(default=None, primary_key=True)
    issue_id: int = Field(foreign_key="issue.id", index=True)
    #: Denormalised from the issue so a report can filter a date range by team
    #: without joining, and so the row survives as history if the issue moves.
    team_id: int = Field(foreign_key="team.id", index=True)
    field: IssueEventField = Field(index=True)
    #: Null on the creation event for a field, and for a value being cleared.
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    actor_id: Optional[int] = Field(default=None, foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow, index=True)


class Comment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    issue_id: int = Field(foreign_key="issue.id", index=True)
    author_id: int = Field(foreign_key="user.id")
    body: str
    created_at: datetime = Field(default_factory=utcnow)
