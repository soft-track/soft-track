"""Time tracking: worklogs on issues (#102).

Jira-lite on purpose. A person logs how long they spent on an issue on a
given day, with an optional note; the issue shows the total and who spent it;
the reports roll it up per cycle and per person. No remaining-estimate
burndown, timers, billing rates or approvals -- see the issue for why.

Only the person who logged an entry can change or delete it. Time is a claim
somebody made about their own day, and an admin quietly editing it is the
kind of change that ends up in an argument about a timesheet.
"""

from collections import defaultdict
from datetime import date, timedelta
from typing import Iterable, Optional

from sqlmodel import Session, delete, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.issues import get_issue_or_404
from lib_softtrack.models.worklogs import (
    IssueTime,
    PersonTime,
    TimeSpent,
    WorklogCreate,
    WorklogRead,
    WorklogUpdate,
)
from lib_softtrack.tables import User, Worklog, utcnow
from lib_softtrack.teams import require_team_member, require_team_writer
from lib_utils.errors import ErrorCode, api_error


def _read(worklog: Worklog, user: User) -> WorklogRead:
    return WorklogRead(
        id=worklog.id,
        issue_id=worklog.issue_id,
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


def issue_time(session: Session, current_user: User, issue_id: int) -> IssueTime:
    issue = get_issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)
    rows = session.exec(
        select(Worklog, User)
        .join(User, User.id == Worklog.user_id)
        .where(Worklog.issue_id == issue_id)
        .order_by(Worklog.worked_on.desc(), Worklog.created_at.desc())
    ).all()
    totals = rollup(rows)
    return IssueTime(
        total_minutes=totals.total_minutes,
        by_person=totals.by_person,
        entries=[_read(worklog, user) for worklog, user in rows],
    )


def log_time(
    session: Session, current_user: User, issue_id: int, payload: WorklogCreate
) -> WorklogRead:
    issue = get_issue_or_404(session, issue_id)
    require_team_writer(issue.team_id, current_user, session)
    worked_on = payload.worked_on or date.today()
    _check_date(worked_on)

    worklog = Worklog(
        issue_id=issue_id,
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
    issue = get_issue_or_404(session, worklog.issue_id)
    require_team_writer(issue.team_id, current_user, session)
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


def delete_for_issue(session: Session, issue_id: int) -> None:
    """Remove an issue's time entries, ahead of the issue itself."""
    session.exec(delete(Worklog).where(Worklog.issue_id == issue_id))
