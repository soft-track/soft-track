"""Recurring tickets (#264): work that comes back on a schedule.

Automation rules react to something happening; none of their eight triggers
is a date. A schedule is: it creates a ticket every day, on chosen weekdays
every N weeks, on a day of every month, quarter or year -- on its first or
last working day, or a date -- with its fields set, in the backlog or the
active sprint. From there the ticket is a ticket like any other.

Two halves, as automation has: the settings page's service (list, add,
edit, pause, remove), and the sweep a loop in the API process runs every few
minutes, the same kind of loop as the due-date reminders and built on the
same two ideas.

**A date, in the instance's morning.** An occurrence is a day, and its
ticket is created at `REMINDER_HOUR` that day in the instance's timezone
(`DEFAULT_TIMEZONE`), as a due-date reminder goes out: `reminders.reminder_day`
says which day's work is due at a moment.

**Each occurrence once.** A `ScheduleRun` row keyed by schedule and day is
inserted before the ticket is created, with `ON CONFLICT DO NOTHING`, and the
worker whose insert took creates it. Two workers waking at once, or a restart
halfway through a morning, both reach the same key; one of them creates the
ticket. A crash between the claim and the ticket loses that one occurrence,
which is better than making it twice.

**One ticket for a gap, not one per missed day.** A loop that was down over a
weekend, or a schedule waiting for the last ticket to be done, creates the
latest occurrence that is due rather than every one it missed: three copies of
"Dependency updates" on a Monday morning are noise, and the point of waiting
for the previous one is that two open copies would be.

It creates nothing while paused, or while its team is archived (#322); an
assignee who has left the team, or been deactivated, gets no ticket and the
ticket is created unassigned; with no active sprint it lands in the backlog.
"""

import asyncio
import calendar
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlmodel import Session, func, select

from lib_identity.models.identity import UserPublic
from lib_softtrack import tickets as tickets_service
from lib_softtrack.models.schedules import (
    Frequency,
    MonthDay,
    ScheduleFields,
    ScheduleRead,
    ScheduleTicketRef,
    ScheduleUpdate,
)
from lib_softtrack.models.tickets import TicketCreate
from lib_softtrack.reminders import reminder_day
from lib_softtrack.sprints import active_sprint
from lib_softtrack.statuses import RESOLVED
from lib_softtrack.tables import (
    Label,
    Project,
    ScheduleRun,
    Team,
    Ticket,
    TicketSchedule,
    User,
    WorkflowStatus,
)
from lib_softtrack.teams import (
    can_be_assigned,
    get_team_or_404,
    require_assignable,
    require_team_admin,
    require_team_member,
)
from lib_utils.errors import ErrorCode, api_error

logger = logging.getLogger(__name__)

#: How far the sweep looks back for an occurrence it has not made yet, and
#: forward for the next one. A year and a bit covers the sparsest schedule
#: there is, once a year or every 52 weeks.
HORIZON = timedelta(days=400)
#: How many of a schedule's tickets its row lists by identifier.
RECENT = 3

_FIELDS = tuple(ScheduleFields.model_fields)


def _columns(fields: ScheduleFields) -> dict:
    """The form as the table stores it: the two vocabularies of when as text."""
    values = fields.model_dump()
    values["frequency"] = fields.frequency.value
    values["month_day"] = fields.month_day.value if fields.month_day else None
    return values


def _zone() -> ZoneInfo:
    from web import settings

    return ZoneInfo(settings.default_timezone)


def _local_today(now: datetime) -> date:
    return now.astimezone(_zone()).date()


# ---------------------------------------------------------------------------
# When
# ---------------------------------------------------------------------------


def _working_days(year: int, month: int) -> list[date]:
    days = calendar.monthrange(year, month)[1]
    return [
        day
        for day in (date(year, month, n) for n in range(1, days + 1))
        if day.weekday() < 5
    ]


def occurs_on(schedule: TicketSchedule, day: date) -> bool:
    """Whether the schedule has an occurrence on `day`, whatever else is true."""
    frequency = Frequency(schedule.frequency)
    if frequency == Frequency.daily:
        return True

    if frequency == Frequency.weekly:
        if day.weekday() not in schedule.weekdays:
            return False
        # Weeks counted Monday to Monday from the week it started in.
        anchor = schedule.starts_on - timedelta(days=schedule.starts_on.weekday())
        week = (day - timedelta(days=day.weekday()) - anchor).days // 7
        return week % schedule.interval == 0

    if frequency == Frequency.quarterly and day.month not in (1, 4, 7, 10):
        return False
    if frequency == Frequency.yearly and day.month != schedule.month:
        return False
    which = MonthDay(schedule.month_day)
    if which == MonthDay.date:
        last = calendar.monthrange(day.year, day.month)[1]
        return day.day == min(schedule.day_of_month, last)
    working = _working_days(day.year, day.month)
    return day == (working[0] if which == MonthDay.first_working_day else working[-1])


def _earliest(schedule: TicketSchedule, last_run: Optional[date]) -> date:
    """The first day an occurrence not made yet could be on."""
    earliest = schedule.active_since
    if last_run is not None:
        earliest = max(earliest, last_run + timedelta(days=1))
    return earliest


def due_occurrence(
    schedule: TicketSchedule, day: date, last_run: Optional[date]
) -> Optional[date]:
    """The latest occurrence that is due by `day` and not made yet, if any."""
    earliest = max(_earliest(schedule, last_run), day - HORIZON)
    candidate = day
    while candidate >= earliest:
        if occurs_on(schedule, candidate):
            return candidate
        candidate -= timedelta(days=1)
    return None


def next_occurrence(
    schedule: TicketSchedule, day: date, last_run: Optional[date]
) -> Optional[date]:
    """The day it creates its next ticket on: one that is due already, or the
    first one after `day`."""
    due = due_occurrence(schedule, day, last_run)
    if due is not None:
        return due
    candidate = max(_earliest(schedule, last_run), day + timedelta(days=1))
    end = candidate + HORIZON
    while candidate <= end:
        if occurs_on(schedule, candidate):
            return candidate
        candidate += timedelta(days=1)
    return None


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def _last_run(session: Session, schedule_id: int) -> Optional[date]:
    return session.exec(
        select(func.max(ScheduleRun.occurs_on)).where(
            ScheduleRun.schedule_id == schedule_id
        )
    ).one()


def _previous_ticket(session: Session, schedule_id: int) -> Optional[Ticket]:
    """The ticket it made last, unless that one has gone -- to the trash too,
    which the ORM leaves out (see trash.py)."""
    return session.exec(
        select(Ticket)
        .join(ScheduleRun, ScheduleRun.ticket_id == Ticket.id)
        .where(ScheduleRun.schedule_id == schedule_id)
        .order_by(ScheduleRun.occurs_on.desc())
        .limit(1)
    ).first()


def _is_open(session: Session, ticket: Ticket) -> bool:
    status = session.get(WorkflowStatus, ticket.status_id)
    return status is None or status.category not in RESOLVED


def _waiting_on(session: Session, schedule: TicketSchedule) -> Optional[Ticket]:
    """The open ticket a schedule that waits for the previous one waits on."""
    if not schedule.wait_for_previous:
        return None
    previous = _previous_ticket(session, schedule.id)
    if previous is not None and _is_open(session, previous):
        return previous
    return None


def _ref(ticket: Ticket, keys: dict[int, str]) -> ScheduleTicketRef:
    return ScheduleTicketRef(
        id=ticket.id,
        identifier=f"{keys[ticket.team_id]}-{ticket.number}",
        title=ticket.title,
    )


def _to_read(session: Session, schedule: TicketSchedule, now: datetime) -> ScheduleRead:
    people = {
        user.id: UserPublic.model_validate(user)
        for user in session.exec(
            select(User).where(
                User.id.in_(
                    {
                        schedule.created_by_id,
                        schedule.assignee_id,
                        schedule.paused_by_id,
                    }
                    - {None}
                )
            )
        ).all()
    }
    made = session.exec(
        select(Ticket)
        .join(ScheduleRun, ScheduleRun.ticket_id == Ticket.id)
        .where(ScheduleRun.schedule_id == schedule.id)
        .order_by(ScheduleRun.occurs_on.desc())
    ).all()
    # A ticket can have moved to another team since (#98): its key is that
    # team's.
    keys = {
        team.id: team.key
        for team in session.exec(
            select(Team).where(Team.id.in_({t.team_id for t in made}))
        ).all()
    }
    waiting = _waiting_on(session, schedule)
    labels = set(
        session.exec(select(Label.id).where(Label.team_id == schedule.team_id)).all()
    )

    return ScheduleRead(
        id=schedule.id,
        team_id=schedule.team_id,
        **{
            field: getattr(schedule, field) for field in _FIELDS if field != "label_ids"
        },
        label_ids=[label for label in schedule.label_ids if label in labels],
        assignee=people.get(schedule.assignee_id),
        paused_at=schedule.paused_at,
        paused_by=people.get(schedule.paused_by_id),
        created_by=people[schedule.created_by_id],
        created_at=schedule.created_at,
        updated_at=schedule.updated_at,
        next_on=(
            None
            if schedule.paused_at is not None
            else next_occurrence(
                schedule, reminder_day(now, _zone()), _last_run(session, schedule.id)
            )
        ),
        created_count=len(made),
        recent_tickets=[_ref(ticket, keys) for ticket in made[:RECENT]],
        waiting_on=_ref(waiting, keys) if waiting is not None else None,
    )


def get_schedule_or_404(
    session: Session, current_user: User, schedule_id: int
) -> TicketSchedule:
    schedule = session.get(TicketSchedule, schedule_id)
    if schedule is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.schedule_not_found,
            detail="Schedule not found",
        )
    require_team_member(schedule.team_id, current_user, session)
    return schedule


def list_schedules(
    session: Session, current_user: User, team_id: int
) -> list[ScheduleRead]:
    """Every schedule on the team, paused or not, in the order they were made.

    Readable by every member, as the rules are: a schedule puts tickets on
    the board, and finding out where one came from should not need an admin.
    """
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    now = datetime.now(timezone.utc)
    return [
        _to_read(session, schedule, now)
        for schedule in session.exec(
            select(TicketSchedule)
            .where(TicketSchedule.team_id == team_id)
            .order_by(TicketSchedule.id)
        ).all()
    ]


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def _not_on_team(what: str):
    return api_error(
        status_code=400,
        code=ErrorCode.not_on_this_team,
        detail=f"No such {what} on this team",
    )


def _validate(session: Session, team_id: int, fields: ScheduleFields) -> None:
    """What it names has to be on its team, and its assignee able to hold a
    ticket there -- as for a ticket somebody files."""
    require_assignable(team_id, fields.assignee_id, session)
    if fields.project_id is not None:
        project = session.get(Project, fields.project_id)
        if project is None or project.team_id != team_id:
            raise _not_on_team("epic")
    if fields.label_ids:
        found = session.exec(
            select(func.count())
            .select_from(Label)
            .where(Label.team_id == team_id, Label.id.in_(fields.label_ids))
        ).one()
        if found != len(fields.label_ids):
            raise _not_on_team("label")


def create_schedule(
    session: Session, current_user: User, team_id: int, payload: ScheduleFields
) -> ScheduleRead:
    """Add a schedule. Team admins only, like the rules beside it: it creates
    work in everybody's backlog without anybody asking."""
    get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)
    _validate(session, team_id, payload)

    now = datetime.now(timezone.utc)
    today = _local_today(now)
    schedule = TicketSchedule(
        team_id=team_id,
        **_columns(payload),
        starts_on=today,
        active_since=today,
        created_by_id=current_user.id,
    )
    session.add(schedule)
    session.commit()
    session.refresh(schedule)
    return _to_read(session, schedule, now)


def update_schedule(
    session: Session, current_user: User, schedule_id: int, payload: ScheduleUpdate
) -> ScheduleRead:
    schedule = get_schedule_or_404(session, current_user, schedule_id)
    require_team_admin(schedule.team_id, current_user, session)
    now = datetime.now(timezone.utc)

    if payload.schedule is not None:
        _validate(session, schedule.team_id, payload.schedule)
        for field, value in _columns(payload.schedule).items():
            setattr(schedule, field, value)

    if payload.paused is True and schedule.paused_at is None:
        schedule.paused_at = now
        schedule.paused_by_id = current_user.id
    elif payload.paused is False and schedule.paused_at is not None:
        schedule.paused_at = None
        schedule.paused_by_id = None
        # Back from today, not from the day it was paused: a schedule that
        # was off for a month does not owe the month a ticket.
        schedule.active_since = max(schedule.active_since, _local_today(now))

    schedule.updated_at = now
    session.add(schedule)
    session.commit()
    session.refresh(schedule)
    return _to_read(session, schedule, now)


def delete_schedule(session: Session, current_user: User, schedule_id: int) -> None:
    """Remove a schedule. The tickets it made stay, and say in their history
    which schedule made them; only its claims go with it."""
    schedule = get_schedule_or_404(session, current_user, schedule_id)
    require_team_admin(schedule.team_id, current_user, session)
    for run in session.exec(
        select(ScheduleRun).where(ScheduleRun.schedule_id == schedule.id)
    ).all():
        session.delete(run)
    session.flush()
    session.delete(schedule)
    session.commit()


def clear_project(session: Session, project_id: int) -> None:
    """An epic purged from the trash: schedules that filed into it file into
    no epic, as its tickets are left in none."""
    for schedule in session.exec(
        select(TicketSchedule).where(TicketSchedule.project_id == project_id)
    ).all():
        schedule.project_id = None
        session.add(schedule)
    session.flush()


# ---------------------------------------------------------------------------
# The sweep
# ---------------------------------------------------------------------------


def _claim(session: Session, schedule_id: int, day: date, now: datetime) -> bool:
    """Insert the claim on this occurrence unless it is there, and say whether
    it took. The database decides -- see reminders._claim."""
    insert = (
        pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
    )
    result = session.exec(
        insert(ScheduleRun)
        .values(schedule_id=schedule_id, occurs_on=day, claimed_at=now)
        .on_conflict_do_nothing()
        # RETURNING rather than `rowcount`, which psycopg reports as -1 here.
        .returning(ScheduleRun.schedule_id)
    )
    return result.first() is not None


def _payload(session: Session, schedule: TicketSchedule, today: date) -> TicketCreate:
    """The ticket, as the schedule says it -- adapted to the team as it is."""
    team_id = schedule.team_id
    assignee_id = schedule.assignee_id
    if assignee_id is not None:
        assignee = session.get(User, assignee_id)
        if (
            assignee is None
            or not assignee.is_active
            or not can_be_assigned(team_id, assignee_id, session)
        ):
            assignee_id = None
    project_id = schedule.project_id
    if (
        project_id is not None
        and session.exec(select(Project.id).where(Project.id == project_id)).first()
        is None
    ):
        # In the trash: the ticket is filed into no epic rather than into one
        # nobody can see.
        project_id = None
    labels = set(session.exec(select(Label.id).where(Label.team_id == team_id)).all())
    sprint = active_sprint(session, team_id) if schedule.into_active_sprint else None
    return TicketCreate(
        title=schedule.title,
        description=schedule.description,
        type=schedule.type,
        priority=schedule.priority,
        assignee_id=assignee_id,
        estimate=schedule.estimate,
        project_id=project_id,
        sprint_id=sprint.id if sprint is not None else None,
        due_date=(
            today + timedelta(days=schedule.due_after_days)
            if schedule.due_after_days is not None
            else None
        ),
        label_ids=[label for label in schedule.label_ids if label in labels],
    )


def _run_one(
    session: Session, schedule: TicketSchedule, day: date, now: datetime
) -> Optional[Ticket]:
    occurrence = due_occurrence(schedule, day, _last_run(session, schedule.id))
    if occurrence is None:
        return None
    if _waiting_on(session, schedule) is not None:
        return None
    if not _claim(session, schedule.id, occurrence, now):
        return None
    # Committed before the ticket is created: the claim is what keeps a
    # second worker from creating it too.
    session.commit()

    team = session.get(Team, schedule.team_id)
    creator = session.get(User, schedule.created_by_id)
    ticket = tickets_service.create_scheduled(
        session,
        team,
        _payload(session, schedule, _local_today(now)),
        creator,
        schedule.title,
    )
    run = session.get(ScheduleRun, (schedule.id, occurrence))
    run.ticket_id = ticket.id
    session.add(run)
    session.commit()
    return ticket


def create_scheduled_tickets(session: Session, now: Optional[datetime] = None) -> int:
    """Create every ticket that is due at `now`. Returns how many."""
    now = now or datetime.now(timezone.utc)
    day = reminder_day(now, _zone())
    schedules = session.exec(
        select(TicketSchedule)
        .join(Team, Team.id == TicketSchedule.team_id)
        .where(
            TicketSchedule.paused_at == None,  # noqa: E711 -- SQL IS NULL
            Team.archived_at == None,  # noqa: E711 -- SQL IS NULL
        )
        .order_by(TicketSchedule.id)
    ).all()

    created = 0
    for schedule in schedules:
        try:
            if _run_one(session, schedule, day, now) is not None:
                created += 1
        except Exception:
            # One schedule that cannot create its ticket must not stop the
            # others. Its claim stays: it is tried again on its next day, not
            # every five minutes until somebody notices.
            session.rollback()
            logger.exception("Schedule %s could not create its ticket", schedule.id)
    return created


async def schedule_loop(interval_seconds: float = 300.0) -> None:
    """Create the tickets that are due every few minutes, forever.

    In-process like the reminder and digest loops; the claim makes it safe to
    run in every worker.
    """
    from web import engine

    def tick() -> None:
        with Session(engine) as session:
            made = create_scheduled_tickets(session)
        if made:
            logger.info("Created %s scheduled tickets", made)

    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception:
            logger.exception("The recurring-ticket sweep failed")
        await asyncio.sleep(interval_seconds)
