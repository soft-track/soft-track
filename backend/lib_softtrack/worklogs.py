"""Time tracking: worklogs on tickets (#102).

Jira-lite on purpose. A person logs how long they spent on a ticket on a
given day, with an optional note; the ticket shows the total and who spent it;
the reports roll it up per sprint and per person. No remaining-estimate
burndown, billing rates or approvals. A per-person timer is an opt-in
convenience; it does not track idle time or activity outside the ticket.

Only the person who logged an entry can change or delete it. Time is a claim
somebody made about their own day, and an admin quietly editing it is the
kind of change that ends up in an argument about a timesheet.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional

from sqlmodel import Session, delete, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.tickets import get_ticket_or_404
from lib_softtrack.models.worklogs import (
    TicketTime,
    PersonTime,
    TimeSpent,
    TimerRead,
    TimerStartRead,
    TimerUpdate,
    WorklogCreate,
    WorklogRead,
    WorklogUpdate,
)
from lib_softtrack.tables import (
    Team,
    TeamMember,
    TeamRole,
    Ticket,
    Timer,
    User,
    Worklog,
    utcnow,
)
from lib_softtrack.teams import require_team_member, require_team_writer
from lib_utils.errors import ErrorCode, api_error


def _read(worklog: Worklog, user: User) -> WorklogRead:
    return WorklogRead(
        id=worklog.id,
        ticket_id=worklog.ticket_id,
        user=UserPublic.model_validate(user),
        minutes=worklog.minutes,
        worked_on=worklog.worked_on,
        note=worklog.note,
        created_at=worklog.created_at,
        updated_at=worklog.updated_at,
    )


def _check_date(worked_on: date) -> None:
    # A day of slack: "today" in Auckland is tomorrow in UTC for most of the
    # day, and the browser sends the user's own date.
    if worked_on > date.today() + timedelta(days=1):
        raise api_error(
            status_code=400,
            code=ErrorCode.worklog_in_future,
            detail="Time can only be logged for a day that has started",
        )


def _clean_note(note: Optional[str]) -> Optional[str]:
    return (note or "").strip() or None


def rollup(rows: Iterable[tuple[Worklog, User]]) -> TimeSpent:
    """Total and per-person minutes, most time first, ties by name."""
    minutes: dict[int, int] = defaultdict(int)
    people: dict[int, User] = {}
    for worklog, user in rows:
        minutes[user.id] += worklog.minutes
        people[user.id] = user
    ordered = sorted(people.values(), key=lambda u: (-minutes[u.id], u.full_name))
    return TimeSpent(
        total_minutes=sum(minutes.values()),
        by_person=[
            PersonTime(user=UserPublic.model_validate(user), minutes=minutes[user.id])
            for user in ordered
        ],
    )


def ticket_time(session: Session, current_user: User, ticket_id: int) -> TicketTime:
    ticket = get_ticket_or_404(session, ticket_id)
    require_team_member(ticket.team_id, current_user, session)
    rows = session.exec(
        select(Worklog, User)
        .join(User, User.id == Worklog.user_id)
        .where(Worklog.ticket_id == ticket_id)
        .order_by(Worklog.worked_on.desc(), Worklog.created_at.desc())
    ).all()
    totals = rollup(rows)
    return TicketTime(
        total_minutes=totals.total_minutes,
        by_person=totals.by_person,
        entries=[_read(worklog, user) for worklog, user in rows],
    )


def log_time(
    session: Session, current_user: User, ticket_id: int, payload: WorklogCreate
) -> WorklogRead:
    ticket = get_ticket_or_404(session, ticket_id)
    require_team_writer(ticket.team_id, current_user, session)
    worked_on = payload.worked_on or date.today()
    _check_date(worked_on)

    worklog = Worklog(
        ticket_id=ticket_id,
        user_id=current_user.id,
        minutes=payload.minutes,
        worked_on=worked_on,
        note=_clean_note(payload.note),
    )
    session.add(worklog)
    session.commit()
    session.refresh(worklog)
    return _read(worklog, current_user)


def _own_worklog(session: Session, current_user: User, worklog_id: int) -> Worklog:
    worklog = session.get(Worklog, worklog_id)
    if worklog is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.worklog_not_found,
            detail="Time entry not found",
        )
    ticket = get_ticket_or_404(session, worklog.ticket_id)
    require_team_writer(ticket.team_id, current_user, session)
    if worklog.user_id != current_user.id:
        raise api_error(
            status_code=403,
            code=ErrorCode.not_your_worklog,
            detail="Only the person who logged this time can change it",
        )
    return worklog


def update_worklog(
    session: Session, current_user: User, worklog_id: int, payload: WorklogUpdate
) -> WorklogRead:
    worklog = _own_worklog(session, current_user, worklog_id)
    if payload.minutes is not None:
        worklog.minutes = payload.minutes
    if payload.worked_on is not None:
        _check_date(payload.worked_on)
        worklog.worked_on = payload.worked_on
    if payload.note is not None:
        worklog.note = _clean_note(payload.note)
    worklog.updated_at = utcnow()
    session.add(worklog)
    session.commit()
    session.refresh(worklog)
    return _read(worklog, current_user)


def delete_worklog(session: Session, current_user: User, worklog_id: int) -> None:
    session.delete(_own_worklog(session, current_user, worklog_id))
    session.commit()


def delete_for_ticket(session: Session, ticket_id: int) -> None:
    """Remove a ticket's time entries and timer, ahead of the ticket itself."""
    session.exec(delete(Worklog).where(Worklog.ticket_id == ticket_id))
    session.exec(delete(Timer).where(Timer.ticket_id == ticket_id))


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _elapsed_seconds(timer: Timer, now: datetime) -> int:
    elapsed = timer.accumulated_seconds
    if timer.paused_at is None:
        elapsed += int((_aware(now) - _aware(timer.last_started_at)).total_seconds())
    return max(0, elapsed)


def _timer_read(session: Session, timer: Timer, now: datetime) -> TimerRead:
    ticket = session.get(Ticket, timer.ticket_id)
    team = session.get(Team, ticket.team_id) if ticket else None
    if ticket is None or team is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.ticket_not_found,
            detail="Ticket not found",
        )
    return TimerRead(
        ticket_id=ticket.id,
        ticket_identifier=f"{timer.ticket_team_key}-{timer.ticket_number}",
        ticket_team_key=timer.ticket_team_key,
        ticket_number=timer.ticket_number,
        started_at=timer.started_at,
        duration_seconds=_elapsed_seconds(timer, now),
        is_paused=timer.paused_at is not None,
        paused_at=timer.paused_at,
        created_at=timer.created_at,
        updated_at=timer.updated_at,
    )


def get_timer(session: Session, current_user: User) -> Optional[TimerRead]:
    timer = session.exec(select(Timer).where(Timer.user_id == current_user.id)).first()
    return _timer_read(session, timer, utcnow()) if timer else None


def start_timer(session: Session, current_user: User, ticket_id: int) -> TimerStartRead:
    ticket = get_ticket_or_404(session, ticket_id)
    require_team_writer(ticket.team_id, current_user, session)
    team = session.get(Team, ticket.team_id)
    if team is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.ticket_not_found,
            detail="Ticket not found",
        )
    now = utcnow()
    existing = session.exec(
        select(Timer).where(Timer.user_id == current_user.id).with_for_update()
    ).first()

    replaced = None
    if existing and existing.ticket_id == ticket_id:
        if existing.paused_at is not None:
            existing.last_started_at = now
            existing.paused_at = None
            existing.updated_at = now
            session.add(existing)
            session.commit()
            session.refresh(existing)
        return TimerStartRead(**_timer_read(session, existing, now).model_dump())
    if existing:
        replaced = _timer_read(session, existing, now)
        session.delete(existing)
        session.flush()

    timer = Timer(
        user_id=current_user.id,
        ticket_id=ticket_id,
        ticket_team_key=team.key,
        ticket_number=ticket.number,
        started_at=now,
        last_started_at=now,
        created_at=now,
        updated_at=now,
    )
    session.add(timer)
    session.commit()
    session.refresh(timer)
    return TimerStartRead(
        **_timer_read(session, timer, now).model_dump(), replaced=replaced
    )


def _timer_for_user(session: Session, current_user: User) -> Timer:
    timer = session.exec(select(Timer).where(Timer.user_id == current_user.id)).first()
    if timer is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.timer_not_found,
            detail="No timer is running",
        )
    ticket = get_ticket_or_404(session, timer.ticket_id)
    require_team_writer(ticket.team_id, current_user, session)
    return timer


def require_timer_access_allowed(session: Session, current_user: User) -> None:
    """Guests have no timer to mutate and are refused."""
    memberships = session.exec(
        select(TeamMember).where(TeamMember.user_id == current_user.id)
    ).all()
    if memberships and all(member.role == TeamRole.guest for member in memberships):
        raise api_error(
            status_code=403,
            code=ErrorCode.team_read_only,
            detail="Guests can not use the timer",
        )


def stop_timer(session: Session, current_user: User) -> None:
    timer = _timer_for_user(session, current_user)
    session.delete(timer)
    session.commit()


def update_timer(
    session: Session, current_user: User, payload: TimerUpdate
) -> TimerRead:
    timer = _timer_for_user(session, current_user)
    now = utcnow()
    if payload.paused and timer.paused_at is None:
        timer.accumulated_seconds = _elapsed_seconds(timer, now)
        timer.paused_at = now
        timer.updated_at = now
    elif not payload.paused and timer.paused_at is not None:
        timer.last_started_at = now
        timer.paused_at = None
        timer.updated_at = now
    session.add(timer)
    session.commit()
    session.refresh(timer)
    return _timer_read(session, timer, now)
