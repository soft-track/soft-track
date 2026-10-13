from fastapi import APIRouter, Depends
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack import time_estimates as time_estimates_service
from lib_softtrack.models.time_estimates import TicketTimeEstimate, TimeRollup
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["time estimates"])


@router.get("/tickets/{ticket_id}/time-estimate", response_model=TicketTimeEstimate)
def ticket_time_estimate(
    ticket_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """The ticket's time estimate against what is logged and what is left,
    on its own and with its sub-tickets (#268)."""
    return time_estimates_service.ticket_estimate(session, current_user, ticket_id)


@router.get("/sprints/{sprint_id}/time", response_model=TimeRollup)
def sprint_time(
    sprint_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Estimated, logged and remaining time across the sprint, and the
    tickets in it that are over their estimate."""
    return time_estimates_service.sprint_time(session, current_user, sprint_id)


@router.get("/projects/{project_id}/time", response_model=TimeRollup)
def project_time(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Estimated, logged and remaining time across the epic, and the tickets
    in it that are over their estimate."""
    return time_estimates_service.project_time(session, current_user, project_id)
