"""SQLModel table definitions and the enums that describe their columns.

The Educare backend has no direct counterpart to this module because it talks to
the database in raw SQL. Here the tables *are* the schema, so they live in one
place under `lib_softtrack` and are imported by both the identity and product
service layers.
"""

import enum
from datetime import datetime, timezone
from typing import Optional

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
    creator_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Comment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    issue_id: int = Field(foreign_key="issue.id", index=True)
    author_id: int = Field(foreign_key="user.id")
    body: str
    created_at: datetime = Field(default_factory=utcnow)
