"""The weekly timesheet (#267): logged time as a grid of days.

The ticket, a sprint's report and a team's report each answer how much time
went on something. None answers "what did I do this week", and somebody on
two teams has their week split over two reports. This is that week: a row
per ticket and a column per day, across every team the person is on -- and,
turned round, a row per person, for a team's admins and for a manager.

**Reading.** Sums by the database, grouped by row and day. Tickets are joined
in every query, so the trash and an outside account's confinement apply as
they do everywhere (see trash.py, outside.py); the tenancy is in the query as
it is on the workload tab: my own time on teams I am on, a team's time for
its admins, and a manager's reports on the teams the manager is on too.

**Writing.** A cell is what my time on a ticket comes to on a day. Typing in
it goes through the same functions as the ticket's Time section -- the same
guards, the same refusal of a day that has not started, the same effect on
what is left (#268): no entries yet logs one; one entry is changed; several
keep the oldest and change or remove the newest; nothing removes them.

**Marked days**, in words as well as colour: a weekday up to today with
nothing logged, and a day over `TIMESHEET_LONG_DAY_HOURS`. "Today" and "this
week" are the instance's (`DEFAULT_TIMEZONE`), as for due-date reminders.

No submitting a week, no locking it, nothing billable (#299).
"""

from collections.abc import Iterable, Iterator
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import func
from sqlmodel import Session, col, select

from lib_identity.models.identity import PersonRef
from lib_identity.models.people import SharedTeam
from lib_softtrack import worklogs
from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.models.timesheet import (
    MyTimesheet,
    PeopleTimesheet,
    TimesheetCell,
    TimesheetDay,
    TimesheetDaySet,
    TimesheetPersonRow,
    TimesheetTicket,
    TimesheetTicketRow,
)
from lib_softtrack.models.worklogs import WorklogCreate, WorklogUpdate
from lib_softtrack.reminders import _zone
from lib_softtrack.tables import (
    Team,
    TeamMember,
    TeamRole,
    Ticket,
    User,
    WorkflowStatus,
    Worklog,
)
from lib_softtrack.teams import (
    get_team_or_404,
    require_team_admin,
    require_team_writer,
)
from lib_softtrack.tickets import get_ticket_or_404
from lib_utils.errors import ErrorCode, api_error
from lib_utils.spreadsheet import safe_text

#: The longest range a grid or an export covers: a year.
MAX_DAYS = 366

CSV_COLUMNS = ["date", "person", "team", "ticket", "title", "hours", "note"]


def today_for(user: User) -> date:
    """The viewer's today: the instance's, until people have a timezone."""
    return datetime.now(_zone(user)).date()


def date_range(
    viewer: User, start: Optional[date], end: Optional[date]
) -> tuple[date, date]:
    """From and to, inclusive. Neither given is this week, Monday to Sunday;
    a start alone is the seven days from it."""
    if start is None:
        today = today_for(viewer)
        start = today - timedelta(days=today.weekday())
    if end is None:
        end = start + timedelta(days=6)
    if end < start or (end - start).days >= MAX_DAYS:
        raise api_error(
            status_code=400,
            code=ErrorCode.timesheet_range_invalid,
            detail=f"A range runs forwards and covers at most {MAX_DAYS} days",
        )
    return start, end


def _days(start: date, end: date) -> list[date]:
    return [start + timedelta(days=n) for n in range((end - start).days + 1)]


def _long_day_minutes() -> int:
    from web import settings

    return settings.timesheet_long_day_hours * 60


def _nothing_logged(day: date, minutes: int, today: date) -> bool:
    """A weekday that has started, with no time on it. Weekends and the days
    still to come say nothing."""
    return day.weekday() < 5 and day <= today and minutes == 0


def _my_teams(session: Session, viewer: User) -> dict[int, TeamRole]:
    return dict(
        session.exec(
            select(TeamMember.team_id, TeamMember.role).where(
                TeamMember.user_id == viewer.id
            )
        ).all()
    )


def _sums(session: Session, key, *where) -> dict[tuple[int, date], int]:
    """Minutes by `(key, day)`, summed by the database. The ticket is joined,
    so what is in the trash or out of an outside account's reach is not."""
    return {
        (row_key, day): int(minutes)
        for row_key, day, minutes in session.exec(
            select(key, Worklog.worked_on, func.sum(Worklog.minutes))
            .join(Ticket, Ticket.id == Worklog.ticket_id)
            .where(*where)
            .group_by(key, Worklog.worked_on)
        ).all()
    }


def _in_range(start: date, end: date) -> list:
    return [Worklog.worked_on >= start, Worklog.worked_on <= end]


def _cells(sums: dict, key: int, days: list[date]) -> list[TimesheetCell]:
    return [TimesheetCell(day=day, minutes=sums.get((key, day), 0)) for day in days]


# --- my time -----------------------------------------------------------------


def my_timesheet(
    session: Session,
    viewer: User,
    start: Optional[date] = None,
    end: Optional[date] = None,
    ticket_ids: Iterable[int] = (),
) -> MyTimesheet:
    """My time, a row per ticket, across every team I am on.

    `ticket_ids` are tickets added to the week by searching for them, shown
    with nothing logged yet -- as long as they are on one of my teams.
    """
    start, end = date_range(viewer, start, end)
    today = today_for(viewer)
    days = _days(start, end)
    teams = _my_teams(session, viewer)
    mine = [
        Worklog.user_id == viewer.id,
        col(Ticket.team_id).in_(list(teams) or [0]),
        *_in_range(start, end),
    ]
    sums = _sums(session, Worklog.ticket_id, *mine)
    # Rows in the order they were first logged in the range, so a row does
    # not jump about while its cells are typed in; added ones last.
    first_logged = {
        ticket_id: first
        for ticket_id, first in session.exec(
            select(Worklog.ticket_id, func.min(Worklog.created_at))
            .join(Ticket, Ticket.id == Worklog.ticket_id)
            .where(*mine)
            .group_by(Worklog.ticket_id)
        ).all()
    }
    added = [ticket_id for ticket_id in ticket_ids if ticket_id not in first_logged]
    ids = [*first_logged, *added]
    tickets = {
        ticket.id: (ticket, status, team)
        for ticket, status, team in session.exec(
            select(Ticket, WorkflowStatus, Team)
            .join(WorkflowStatus, WorkflowStatus.id == Ticket.status_id)
            .join(Team, Team.id == Ticket.team_id)
            .where(
                col(Ticket.id).in_(ids or [0]),
                col(Ticket.team_id).in_(list(teams) or [0]),
            )
        ).all()
    }
    order = {ticket_id: n for n, ticket_id in enumerate(added)}
    ids = sorted(
        (ticket_id for ticket_id in ids if ticket_id in tickets),
        key=lambda ticket_id: (
            ticket_id not in first_logged,
            first_logged.get(ticket_id) or datetime.min,
            order.get(ticket_id, 0),
            ticket_id,
        ),
    )

    rows = []
    for ticket_id in ids:
        ticket, status, team = tickets[ticket_id]
        cells = _cells(sums, ticket_id, days)
        rows.append(
            TimesheetTicketRow(
                ticket=TimesheetTicket(
                    id=ticket.id,
                    team_id=team.id,
                    team_key=team.key,
                    number=ticket.number,
                    identifier=f"{team.key}-{ticket.number}",
                    title=ticket.title,
                    type=ticket.type,
                    priority=ticket.priority,
                    status=StatusRead.model_validate(status),
                    can_log=teams.get(team.id) != TeamRole.guest,
                ),
                days=cells,
                minutes=sum(cell.minutes for cell in cells),
            )
        )

    long_day = _long_day_minutes()
    columns = []
    for day in days:
        minutes = sum(m for (_, d), m in sums.items() if d == day)
        columns.append(
            TimesheetDay(
                day=day,
                minutes=minutes,
                nothing_logged=_nothing_logged(day, minutes, today),
                over=minutes > long_day,
            )
        )

    run = [team_id for team_id, role in teams.items() if role == TeamRole.admin]
    return MyTimesheet(
        start=start,
        end=end,
        today=today,
        long_day_minutes=long_day,
        days=columns,
        minutes=sum(sums.values()),
        tickets=rows,
        teams_i_run=sorted(
            (
                SharedTeam.model_validate(team)
                for team in session.exec(
                    select(Team).where(
                        col(Team.id).in_(run or [0]),
                        Team.archived_at == None,  # noqa: E711 -- SQL IS NULL
                    )
                ).all()
            ),
            key=lambda team: (team.name.lower(), team.id),
        ),
        has_reports=bool(_reports(session, viewer, teams)),
    )


def set_my_day(
    session: Session,
    viewer: User,
    ticket_id: int,
    worked_on: date,
    payload: TimesheetDaySet,
) -> TimesheetCell:
    """Make my time on a ticket on a day come to `payload.minutes`.

    Through the worklog functions the ticket's Time section uses, so the
    guards, the refusal of a day still to come and the effect on what is
    left (#268) are theirs.
    """
    ticket = get_ticket_or_404(session, ticket_id)
    require_team_writer(ticket.team_id, viewer, session)
    entries = list(
        session.exec(
            select(Worklog)
            .where(
                Worklog.ticket_id == ticket_id,
                Worklog.user_id == viewer.id,
                Worklog.worked_on == worked_on,
            )
            .order_by(Worklog.created_at, Worklog.id)
        ).all()
    )
    target = payload.minutes
    if sum(entry.minutes for entry in entries) != target:
        if not entries:
            worklogs.log_time(
                session,
                viewer,
                ticket_id,
                WorklogCreate(minutes=target, worked_on=worked_on),
            )
        else:
            # The newest entry takes the difference. Where the older ones
            # already come to the new figure, it goes, and the next newest
            # takes it -- down to none, for an empty cell.
            while entries and sum(e.minutes for e in entries[:-1]) >= target:
                worklogs.delete_worklog(session, viewer, entries.pop().id)
            if entries:
                rest = sum(e.minutes for e in entries[:-1])
                worklogs.update_worklog(
                    session,
                    viewer,
                    entries[-1].id,
                    WorklogUpdate(minutes=target - rest),
                )
    return TimesheetCell(day=worked_on, minutes=target)


# --- a row per person --------------------------------------------------------


def _reports(
    session: Session, viewer: User, teams: Optional[dict[int, TeamRole]] = None
) -> list[User]:
    """The viewer's active direct reports who are on a team with them."""
    teams = _my_teams(session, viewer) if teams is None else teams
    shared = select(TeamMember.user_id).where(
        col(TeamMember.team_id).in_(list(teams) or [0])
    )
    return list(
        session.exec(
            select(User)
            .where(
                User.manager_id == viewer.id,
                User.is_active == True,  # noqa: E712 -- SQL comparison
                col(User.id).in_(shared),
            )
            .order_by(func.lower(User.full_name), User.id)
        ).all()
    )


def _people_timesheet(
    start: date,
    end: date,
    today: date,
    people: list[User],
    sums: dict[tuple[int, date], int],
    team: Optional[Team] = None,
) -> PeopleTimesheet:
    days = _days(start, end)
    long_day = _long_day_minutes()
    rows = []
    for person in people:
        cells = _cells(sums, person.id, days)
        rows.append(
            TimesheetPersonRow(
                person=PersonRef.model_validate(person),
                days=cells,
                minutes=sum(cell.minutes for cell in cells),
            )
        )
    columns = []
    for index, day in enumerate(days):
        without = [
            row.person
            for row in rows
            if _nothing_logged(day, row.days[index].minutes, today)
        ]
        over = [row.person for row in rows if row.days[index].minutes > long_day]
        columns.append(
            TimesheetDay(
                day=day,
                minutes=sum(row.days[index].minutes for row in rows),
                nothing_logged=bool(without),
                over=bool(over),
                people_without_time=without,
                people_over=over,
            )
        )
    return PeopleTimesheet(
        start=start,
        end=end,
        today=today,
        long_day_minutes=long_day,
        days=columns,
        minutes=sum(row.minutes for row in rows),
        team=SharedTeam.model_validate(team) if team else None,
        people=rows,
    )


def _by_name(people: Iterable[User]) -> list[User]:
    return sorted(people, key=lambda user: (user.full_name.lower(), user.id))


def team_timesheet(
    session: Session,
    viewer: User,
    team_id: int,
    start: Optional[date] = None,
    end: Optional[date] = None,
) -> PeopleTimesheet:
    """A team's week, for its admins: a row per person, time on its tickets.

    Everybody who can log time on it -- its admins and members -- whether
    they did or not, and anybody else whose time is on its tickets.
    """
    team = get_team_or_404(team_id, session)
    require_team_admin(team_id, viewer, session)
    start, end = date_range(viewer, start, end)
    sums = _sums(
        session,
        Worklog.user_id,
        Ticket.team_id == team_id,
        *_in_range(start, end),
    )
    loggers = {user_id for user_id, _ in sums}
    members = select(TeamMember.user_id).where(
        TeamMember.team_id == team_id, TeamMember.role != TeamRole.guest
    )
    people = session.exec(
        select(User).where(
            (col(User.id).in_(members) & (User.is_active == True))  # noqa: E712
            | col(User.id).in_(list(loggers) or [0])
        )
    ).all()
    return _people_timesheet(
        start, end, today_for(viewer), _by_name(people), sums, team=team
    )


def reports_timesheet(
    session: Session,
    viewer: User,
    start: Optional[date] = None,
    end: Optional[date] = None,
) -> PeopleTimesheet:
    """A manager's reports, a row each: their time on the teams the manager
    is on too, and nothing on any other."""
    start, end = date_range(viewer, start, end)
    teams = _my_teams(session, viewer)
    people = _reports(session, viewer, teams)
    sums = _sums(
        session,
        Worklog.user_id,
        col(Worklog.user_id).in_([person.id for person in people] or [0]),
        col(Ticket.team_id).in_(list(teams) or [0]),
        *_in_range(start, end),
    )
    return _people_timesheet(start, end, today_for(viewer), people, sums)


# --- CSV ---------------------------------------------------------------------


def _hours(minutes: int) -> str:
    """Minutes as hours a spreadsheet sums: `7.5`, `10`."""
    return f"{minutes / 60:.2f}".rstrip("0").rstrip(".")


def _export(session: Session, *where) -> Iterator[list[str]]:
    """One line per entry, oldest day first, header first."""
    yield CSV_COLUMNS
    for worklog, ticket, team, user in session.exec(
        select(Worklog, Ticket, Team, User)
        .join(Ticket, Ticket.id == Worklog.ticket_id)
        .join(Team, Team.id == Ticket.team_id)
        .join(User, User.id == Worklog.user_id)
        .where(*where)
        .order_by(
            Worklog.worked_on,
            func.lower(User.full_name),
            Team.key,
            Ticket.number,
            Worklog.id,
        )
    ).all():
        yield [
            worklog.worked_on.isoformat(),
            safe_text(user.full_name),
            team.key,
            f"{team.key}-{ticket.number}",
            safe_text(ticket.title),
            _hours(worklog.minutes),
            safe_text(worklog.note or ""),
        ]


def export_mine(
    session: Session, viewer: User, start: Optional[date], end: Optional[date]
) -> tuple[date, date, Iterator[list[str]]]:
    start, end = date_range(viewer, start, end)
    teams = _my_teams(session, viewer)
    return (
        start,
        end,
        _export(
            session,
            Worklog.user_id == viewer.id,
            col(Ticket.team_id).in_(list(teams) or [0]),
            *_in_range(start, end),
        ),
    )


def export_team(
    session: Session,
    viewer: User,
    team_id: int,
    start: Optional[date],
    end: Optional[date],
) -> tuple[Team, date, date, Iterator[list[str]]]:
    team = get_team_or_404(team_id, session)
    require_team_admin(team_id, viewer, session)
    start, end = date_range(viewer, start, end)
    return (
        team,
        start,
        end,
        _export(session, Ticket.team_id == team_id, *_in_range(start, end)),
    )


def export_reports(
    session: Session, viewer: User, start: Optional[date], end: Optional[date]
) -> tuple[date, date, Iterator[list[str]]]:
    start, end = date_range(viewer, start, end)
    teams = _my_teams(session, viewer)
    people = _reports(session, viewer, teams)
    return (
        start,
        end,
        _export(
            session,
            col(Worklog.user_id).in_([person.id for person in people] or [0]),
            col(Ticket.team_id).in_(list(teams) or [0]),
            *_in_range(start, end),
        ),
    )
