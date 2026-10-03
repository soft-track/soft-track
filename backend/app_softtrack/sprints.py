from typing import Optional

from fastapi import APIRouter, Body, Depends
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_user
from lib_softtrack import sprints as sprints_service
from lib_softtrack.models.sprints import (
    RetroActionCreate,
    RetroActionRead,
    RetrospectiveUpdate,
    SprintCompleteRequest,
    SprintCompletion,
    SprintCreate,
    SprintRead,
    SprintUpdate,
)
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["sprints"])


@router.post(
    "/teams/{team_id}/sprints", response_model=SprintRead, dependencies=[team_writer]
)
def create_sprint(
    team_id: int,
    payload: SprintCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return sprints_service.create_sprint(session, current_user, team_id, payload)


@router.get("/teams/{team_id}/sprints", response_model=list[SprintRead])
def list_sprints(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return sprints_service.list_sprints(session, current_user, team_id)


@router.get("/sprints/{sprint_id}", response_model=SprintRead)
def get_sprint(
    sprint_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return sprints_service.get_sprint(session, current_user, sprint_id)


@router.patch(
    "/sprints/{sprint_id}", response_model=SprintRead, dependencies=[team_writer]
)
def update_sprint(
    sprint_id: int,
    payload: SprintUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return sprints_service.update_sprint(session, current_user, sprint_id, payload)


@router.post(
    "/sprints/{sprint_id}/start", response_model=SprintRead, dependencies=[team_writer]
)
def start_sprint(
    sprint_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Make this the team's active sprint. Only one may be active at a time."""
    return sprints_service.start_sprint(session, current_user, sprint_id)


@router.post(
    "/sprints/{sprint_id}/complete",
    response_model=SprintCompletion,
    dependencies=[team_writer],
)
def complete_sprint(
    sprint_id: int,
    payload: Optional[SprintCompleteRequest] = Body(None),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Close the sprint, carrying unfinished tickets into the next one.

    Nothing is deleted: if there is no later sprint to carry into, the
    unfinished tickets go back to the backlog. The body, all of it optional,
    says whether the goal was met and starts the retrospective (#271).
    """
    return sprints_service.complete_sprint(session, current_user, sprint_id, payload)


@router.patch(
    "/sprints/{sprint_id}/retrospective",
    response_model=SprintRead,
    dependencies=[team_writer],
)
def update_retrospective(
    sprint_id: int,
    payload: RetrospectiveUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Write to a completed sprint's retrospective, while it is open (#271)."""
    return sprints_service.update_retrospective(
        session, current_user, sprint_id, payload
    )


@router.post(
    "/sprints/{sprint_id}/retrospective/close",
    response_model=SprintRead,
    dependencies=[team_writer],
)
def close_retrospective(
    sprint_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Stop the retrospective changing. A team admin's (#271)."""
    return sprints_service.close_retrospective(session, current_user, sprint_id)


@router.post(
    "/sprints/{sprint_id}/retrospective/actions",
    response_model=RetroActionRead,
    dependencies=[team_writer],
)
def create_retro_action(
    sprint_id: int,
    payload: RetroActionCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Make a ticket of a line from "what to change" (#271)."""
    return sprints_service.create_action(session, current_user, sprint_id, payload)


@router.delete("/sprints/{sprint_id}", status_code=204, dependencies=[team_writer])
def delete_sprint(
    sprint_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    sprints_service.delete_sprint(session, current_user, sprint_id)
