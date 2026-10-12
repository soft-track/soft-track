import csv
import io
from collections.abc import Iterator
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_insider, get_current_user
from lib_softtrack import timesheet as timesheet_service
from lib_softtrack.models.timesheet import (
    MyTimesheet,
    PeopleTimesheet,
    TimesheetCell,
    TimesheetDaySet,
)
from lib_softtrack.tables import User
from lib_utils.spreadsheet import BOM
from web import get_session

router = APIRouter(tags=["timesheet"])

_FROM = Query(
    default=None,
    alias="from",
    description="The first day. Omitted, this week's Monday in the "
    "instance's timezone.",
)
_TO = Query(
    default=None,
    alias="to",
    description="The last day, included. Omitted, six days after `from`.",
)
_CSV = {200: {"content": {"text/csv": {}}}}


def _csv(rows: Iterator[list[str]], filename: str) -> Response:
    buffer = io.StringIO()
    buffer.write(BOM)
    writer = csv.writer(buffer, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    writer.writerows(rows)
    return Response(
        content=buffer.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _name(prefix: str, start: date, end: date) -> str:
    return f"{prefix}-{start.isoformat()}-{end.isoformat()}.csv"


@router.get("/me/worklogs", response_model=MyTimesheet)
def my_timesheet(
    start: Optional[date] = _FROM,
    end: Optional[date] = _TO,
    ticket_id: list[int] = Query(
        default=[],
        description="Tickets added to the week by searching, shown with "
        "nothing logged yet.",
    ),
    session: Session = Depends(get_session),
    viewer: User = Depends(get_current_user),
):
    """My time, a row per ticket and a column per day, across every team I
    am on (#267): the totals per day and for the range, and which days are
    marked -- a weekday with nothing logged, and a long one."""
    return timesheet_service.my_timesheet(session, viewer, start, end, ticket_id)


@router.get("/me/worklogs/export", response_class=Response, responses=_CSV)
def export_my_timesheet(
    start: Optional[date] = _FROM,
    end: Optional[date] = _TO,
    session: Session = Depends(get_session),
    viewer: User = Depends(get_current_user),
):
    """My time over a range, as CSV: one line per entry."""
    start, end, rows = timesheet_service.export_mine(session, viewer, start, end)
    return _csv(rows, _name("my-time", start, end))


@router.put(
    "/tickets/{ticket_id}/worklogs/days/{worked_on}",
    response_model=TimesheetCell,
    dependencies=[team_writer],
)
def set_my_day(
    ticket_id: int,
    worked_on: date,
    payload: TimesheetDaySet,
    session: Session = Depends(get_session),
    viewer: User = Depends(get_current_user),
):
    """Make my time on the ticket on that day come to `minutes`, as typing in
    a timesheet cell does. Logs, changes or removes my entries for the day
    the way the ticket's Time section would; 0 removes them."""
    return timesheet_service.set_my_day(session, viewer, ticket_id, worked_on, payload)


@router.get("/me/reports/worklogs", response_model=PeopleTimesheet)
def reports_timesheet(
    start: Optional[date] = _FROM,
    end: Optional[date] = _TO,
    session: Session = Depends(get_session),
    viewer: User = Depends(get_current_insider),
):
    """My direct reports' time, a row each -- on the teams I am on too, and
    on no other."""
    return timesheet_service.reports_timesheet(session, viewer, start, end)


@router.get("/me/reports/worklogs/export", response_class=Response, responses=_CSV)
def export_reports_timesheet(
    start: Optional[date] = _FROM,
    end: Optional[date] = _TO,
    session: Session = Depends(get_session),
    viewer: User = Depends(get_current_insider),
):
    """My reports' time over a range, as CSV: one line per entry."""
    start, end, rows = timesheet_service.export_reports(session, viewer, start, end)
    return _csv(rows, _name("reports-time", start, end))


@router.get("/teams/{team_id}/worklogs", response_model=PeopleTimesheet)
def team_timesheet(
    team_id: int,
    start: Optional[date] = _FROM,
    end: Optional[date] = _TO,
    session: Session = Depends(get_session),
    viewer: User = Depends(get_current_user),
):
    """A team's week, for its admins: a row per person, their time on the
    team's tickets."""
    return timesheet_service.team_timesheet(session, viewer, team_id, start, end)


@router.get("/teams/{team_id}/worklogs/export", response_class=Response, responses=_CSV)
def export_team_timesheet(
    team_id: int,
    start: Optional[date] = _FROM,
    end: Optional[date] = _TO,
    session: Session = Depends(get_session),
    viewer: User = Depends(get_current_user),
):
    """The team's time over a range, as CSV, for its admins."""
    team, start, end, rows = timesheet_service.export_team(
        session, viewer, team_id, start, end
    )
    return _csv(rows, _name(f"{team.key.lower()}-time", start, end))
