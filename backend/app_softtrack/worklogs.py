from fastapi import APIRouter, Depends, Response
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_insider, get_current_user
from lib_softtrack import worklogs as worklogs_service
from lib_softtrack.models.worklogs import (
    TicketTime,
    TimerRead,
    TimerStartRead,
    TimerUpdate,
    WorklogCreate,
    WorklogRead,
    WorklogUpdate,
)
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["worklogs"])


def _timer_access_guard(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    worklogs_service.require_timer_access_allowed(session, current_user)


@router.get("/tickets/{ticket_id}/worklogs", response_model=TicketTime)
def ticket_time(
    ticket_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Time spent on the ticket: the total, who spent it, and every entry."""
    return worklogs_service.ticket_time(session, current_user, ticket_id)


@router.post(
    "/tickets/{ticket_id}/worklogs",
    response_model=WorklogRead,
    dependencies=[team_writer],
)
def log_time(
    ticket_id: int,
    payload: WorklogCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Log time you spent on the ticket, on one day."""
    return worklogs_service.log_time(session, current_user, ticket_id, payload)


@router.post(
    "/tickets/{ticket_id}/timer",
    response_model=TimerStartRead,
    dependencies=[team_writer],
)
def start_timer(
    ticket_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Start timing a ticket, replacing any other timer the caller had."""
    return worklogs_service.start_timer(session, current_user, ticket_id)


@router.get(
    "/me/timer",
    response_model=TimerRead | None,
    dependencies=[Depends(_timer_access_guard)],
)
def my_timer(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Return the caller's one active timer, if there is one."""
    return worklogs_service.get_timer(session, current_user)


@router.delete(
    "/me/timer", status_code=204, dependencies=[Depends(_timer_access_guard)]
)
def stop_timer(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Stop the caller's timer and return its elapsed time for review."""
    worklogs_service.stop_timer(session, current_user)
    return Response(status_code=204)


@router.patch(
    "/me/timer",
    response_model=TimerRead,
    dependencies=[Depends(_timer_access_guard)],
)
def update_timer(
    payload: TimerUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Pause or resume the caller's timer."""
    return worklogs_service.update_timer(session, current_user, payload)


@router.patch(
    "/worklogs/{worklog_id}", response_model=WorklogRead, dependencies=[team_writer]
)
def update_worklog(
    worklog_id: int,
    payload: WorklogUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Change one of your own entries."""
    return worklogs_service.update_worklog(session, current_user, worklog_id, payload)


@router.delete("/worklogs/{worklog_id}", status_code=204, dependencies=[team_writer])
def delete_worklog(
    worklog_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Delete one of your own entries."""
    worklogs_service.delete_worklog(session, current_user, worklog_id)
    return Response(status_code=204)
