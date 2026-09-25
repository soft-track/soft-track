from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field

from lib_identity.models.identity import UserPublic

#: One entry is one day's work (#102), so it cannot be more than a day.
MAX_MINUTES = 24 * 60


class WorklogCreate(BaseModel):
    minutes: int = Field(ge=1, le=MAX_MINUTES)
    #: Omitted means today -- the server's today. The browser sends its own,
    #: so somebody logging at 11pm in Sydney logs it on the right day.
    worked_on: Optional[date] = None
    note: Optional[str] = Field(default=None, max_length=500)


class WorklogUpdate(BaseModel):
    minutes: Optional[int] = Field(default=None, ge=1, le=MAX_MINUTES)
    worked_on: Optional[date] = None
    #: An empty string clears it.
    note: Optional[str] = Field(default=None, max_length=500)


class WorklogRead(BaseModel):
    id: int
    issue_id: int
    user: UserPublic
    minutes: int
    worked_on: date
    note: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class PersonTime(BaseModel):
    user: UserPublic
    minutes: int


class IssueTime(BaseModel):
    """Everything the issue panel shows about time spent on one issue."""

    total_minutes: int
    #: Most time first.
    by_person: list[PersonTime]
    #: Most recent day first.
    entries: list[WorklogRead]


class TimeSpent(BaseModel):
    """A rollup for a report: how much time, and whose (#102)."""

    total_minutes: int
    #: Most time first.
    by_person: list[PersonTime]
