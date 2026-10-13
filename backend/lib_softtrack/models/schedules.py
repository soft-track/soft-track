import enum
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.tickets import Estimate
from lib_softtrack.tables import TicketPriority, TicketType


class Frequency(str, enum.Enum):
    """How often a schedule comes round (#264). No cron syntax."""

    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"
    #: The first month of each calendar quarter: January, April, July, October.
    quarterly = "quarterly"
    yearly = "yearly"


class MonthDay(str, enum.Enum):
    """Which day of the month a monthly, quarterly or yearly schedule is on.

    A working day is Monday to Friday; there is no holiday calendar.
    """

    date = "date"
    first_working_day = "first_working_day"
    last_working_day = "last_working_day"


#: The frequencies that land on a day of a month.
MONTHLY = {Frequency.monthly, Frequency.quarterly, Frequency.yearly}


class ScheduleFields(BaseModel):
    """What a schedule creates, how often, and where it lands.

    The whole form, sent whole: the dialog writes every field, so a create
    and an edit are the same shape, and the questions about the combination
    -- weekdays for a week, a day for a month -- are asked once, here. What a
    frequency does not use is cleared rather than kept, so a schedule read
    back says only what it means.
    """

    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=20000)
    type: TicketType = TicketType.task
    priority: TicketPriority = TicketPriority.no_priority
    assignee_id: Optional[int] = None
    label_ids: list[int] = []
    #: The epic.
    project_id: Optional[int] = None
    estimate: Estimate = None
    #: A due date this many days after the day it is created; none when null.
    due_after_days: Optional[int] = Field(default=None, ge=0, le=365)
    #: Into the active sprint when there is one, the backlog when there is not.
    into_active_sprint: bool = False

    frequency: Frequency
    #: Every this many weeks, for a weekly schedule.
    interval: int = Field(default=1, ge=1, le=52)
    #: Monday is 0. For a weekly schedule, at least one.
    weekdays: list[int] = []
    month_day: Optional[MonthDay] = None
    day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    #: For a yearly schedule, 1 to 12.
    month: Optional[int] = Field(default=None, ge=1, le=12)
    #: Only once the ticket it made last is done.
    wait_for_previous: bool = False

    @field_validator("title")
    @classmethod
    def _title_is_words(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A schedule needs a title for what it creates.")
        return value

    @field_validator("weekdays")
    @classmethod
    def _weekdays_are_days(cls, value: list[int]) -> list[int]:
        if any(day < 0 or day > 6 for day in value):
            raise ValueError("Weekdays run from 0, Monday, to 6, Sunday.")
        return sorted(set(value))

    @model_validator(mode="after")
    def _says_when(self) -> "ScheduleFields":
        self.label_ids = list(dict.fromkeys(self.label_ids))
        if self.frequency == Frequency.weekly:
            if not self.weekdays:
                raise ValueError("A weekly schedule needs at least one weekday.")
        else:
            self.interval = 1
            self.weekdays = []

        if self.frequency in MONTHLY:
            if self.month_day is None:
                raise ValueError("Say which day of the month it is on.")
            if self.month_day == MonthDay.date and self.day_of_month is None:
                raise ValueError("Say which date of the month it is on.")
            if self.frequency == Frequency.yearly and self.month is None:
                raise ValueError("Say which month a yearly schedule is in.")
        else:
            self.month_day = None
        if self.month_day != MonthDay.date:
            self.day_of_month = None
        if self.frequency != Frequency.yearly:
            self.month = None
        return self


class ScheduleUpdate(BaseModel):
    """Pausing and editing are separate gestures and each sends only its own:
    `paused` from the switch, `schedule` -- the whole form -- from the dialog."""

    paused: Optional[bool] = None
    schedule: Optional[ScheduleFields] = None


class ScheduleTicketRef(BaseModel):
    """A ticket a schedule created, as the schedule lists it."""

    id: int
    identifier: str
    title: str


class ScheduleRead(ScheduleFields):
    id: int
    team_id: int
    #: Who it is for, by name -- also once they have left the team, when the
    #: tickets it makes are created unassigned.
    assignee: Optional[UserPublic] = None
    paused_at: Optional[datetime] = None
    paused_by: Optional[UserPublic] = None
    created_by: UserPublic
    created_at: datetime
    updated_at: datetime
    #: The day it creates its next ticket on; null while it is paused. Today,
    #: or earlier, for one that is due and has not been made yet -- one
    #: waiting for the last ticket to be done, say.
    next_on: Optional[date] = None
    #: How many tickets it has created, and the latest few, newest first.
    created_count: int = 0
    recent_tickets: list[ScheduleTicketRef] = []
    #: The open ticket a schedule that waits for the previous one is waiting
    #: on; null when it is not waiting.
    waiting_on: Optional[ScheduleTicketRef] = None
