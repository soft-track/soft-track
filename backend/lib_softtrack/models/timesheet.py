"""The weekly timesheet (#267): logged time as a grid of days."""

from datetime import date
from typing import Optional

from pydantic import BaseModel, Field

from lib_identity.models.identity import PersonRef
from lib_identity.models.people import SharedTeam
from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.models.worklogs import MAX_MINUTES
from lib_softtrack.tables import TicketPriority, TicketType


class TimesheetCell(BaseModel):
    """One row's time on one day."""

    day: date
    minutes: int


class TimesheetDay(BaseModel):
    """A column: the day's total, and what is marked about it.

    `nothing_logged` is a weekday up to today with no time on it -- for a
    row per person, somebody's (`people_without_time` says whose). `over`
    is more than the instance's long day (`TIMESHEET_LONG_DAY_HOURS`).
    """

    day: date
    minutes: int
    nothing_logged: bool = False
    over: bool = False
    #: On a row per person: who logged nothing, and who logged too much.
    people_without_time: list[PersonRef] = []
    people_over: list[PersonRef] = []


class TimesheetTicket(BaseModel):
    id: int
    team_id: int
    team_key: str
    number: int
    identifier: str
    title: str
    type: TicketType
    priority: TicketPriority
    status: StatusRead
    #: False where the viewer is a guest now: the row shows, the cells are
    #: not for typing in.
    can_log: bool


class TimesheetTicketRow(BaseModel):
    ticket: TimesheetTicket
    #: One per day of the range, nothing logged included.
    days: list[TimesheetCell]
    minutes: int


class TimesheetPersonRow(BaseModel):
    person: PersonRef
    days: list[TimesheetCell]
    minutes: int


class Timesheet(BaseModel):
    start: date
    end: date
    #: Today in the instance's timezone: the days after it are not marked,
    #: and are not for logging.
    today: date
    long_day_minutes: int
    #: One per day of the range.
    days: list[TimesheetDay]
    minutes: int


class MyTimesheet(Timesheet):
    """My time (#267): a row per ticket, across every team I am on."""

    tickets: list[TimesheetTicketRow]
    #: The other grids the viewer may open: the teams they run, and their
    #: reports' time, if anybody reports to them.
    teams_i_run: list[SharedTeam]
    has_reports: bool


class PeopleTimesheet(Timesheet):
    """A team's week, or a manager's reports: a row per person."""

    #: The team, for a team's week; none for a manager's reports.
    team: Optional[SharedTeam] = None
    people: list[TimesheetPersonRow]


class TimesheetDaySet(BaseModel):
    """What my time on a ticket comes to on one day. Nothing clears it."""

    minutes: int = Field(ge=0, le=MAX_MINUTES)
