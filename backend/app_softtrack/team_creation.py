"""The site admin's side of who may create teams (#306)."""

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlmodel import Session

from lib_identity.admin import require_site_admin
from lib_softtrack import team_creation
from lib_softtrack.models.team_creation import (
    TeamCreationSettings,
    TeamCreationUpdate,
    TeamRequestDecline,
    TeamRequestRead,
)
from lib_softtrack.models.teams import TeamRead
from lib_softtrack.tables import User
from lib_utils.mailer import get_mailer
from web import get_session

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/team-creation", response_model=TeamCreationSettings)
def get_team_creation(
    session: Session = Depends(get_session),
    _: User = Depends(require_site_admin),
):
    """Who may create teams, the people named, and the requests waiting."""
    return team_creation.get_settings(session)


@router.put("/team-creation", response_model=TeamCreationSettings)
def update_team_creation(
    payload: TeamCreationUpdate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_site_admin),
):
    return team_creation.update_settings(session, actor, payload)


@router.post("/team-requests/{request_id}/approve", response_model=TeamRead)
def approve_team_request(
    request_id: int,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
    actor: User = Depends(require_site_admin),
):
    """Create the team, with the person who asked as its admin."""
    team, message = team_creation.approve_request(session, actor, request_id)
    if message is not None:
        background.add_task(get_mailer().send, *message)
    return team


@router.post("/team-requests/{request_id}/decline", response_model=TeamRequestRead)
def decline_team_request(
    request_id: int,
    payload: TeamRequestDecline,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
    actor: User = Depends(require_site_admin),
):
    request, message = team_creation.decline_request(
        session, actor, request_id, payload
    )
    if message is not None:
        background.add_task(get_mailer().send, *message)
    return request
