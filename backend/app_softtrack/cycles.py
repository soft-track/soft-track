from fastapi import APIRouter, Depends
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack import cycles as cycles_service
from lib_softtrack.models.cycles import (
    CycleCompletion,
    CycleCreate,
    CycleRead,
    CycleUpdate,
)
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["cycles"])


@router.post("/teams/{team_id}/cycles", response_model=CycleRead)
def create_cycle(
    team_id: int,
    payload: CycleCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return cycles_service.create_cycle(session, current_user, team_id, payload)


@router.get("/teams/{team_id}/cycles", response_model=list[CycleRead])
def list_cycles(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return cycles_service.list_cycles(session, current_user, team_id)


@router.get("/cycles/{cycle_id}", response_model=CycleRead)
def get_cycle(
    cycle_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return cycles_service.get_cycle(session, current_user, cycle_id)


@router.patch("/cycles/{cycle_id}", response_model=CycleRead)
def update_cycle(
    cycle_id: int,
    payload: CycleUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return cycles_service.update_cycle(session, current_user, cycle_id, payload)


@router.post("/cycles/{cycle_id}/start", response_model=CycleRead)
def start_cycle(
    cycle_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Make this the team's active cycle. Only one may be active at a time."""
    return cycles_service.start_cycle(session, current_user, cycle_id)


@router.post("/cycles/{cycle_id}/complete", response_model=CycleCompletion)
def complete_cycle(
    cycle_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Close the cycle, carrying unfinished issues into the next one.

    Nothing is deleted: if there is no later cycle to carry into, the
    unfinished issues go back to the backlog.
    """
    return cycles_service.complete_cycle(session, current_user, cycle_id)


@router.delete("/cycles/{cycle_id}", status_code=204)
def delete_cycle(
    cycle_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    cycles_service.delete_cycle(session, current_user, cycle_id)
