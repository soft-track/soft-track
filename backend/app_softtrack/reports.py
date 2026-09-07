from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack import reports as reports_service
from lib_softtrack.models.reports import (
    Burndown,
    CreatedVsResolved,
    CumulativeFlow,
    Velocity,
)
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["reports"])


@router.get("/cycles/{cycle_id}/burndown", response_model=Burndown)
def cycle_burndown(
    cycle_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Points and issues outstanding on each day of the cycle.

    Carries the burnup line and the days scope moved, from the same data --
    a burndown that hides scope changes makes a team look slow when what
    actually happened is that the sprint grew.
    """
    return reports_service.burndown(session, current_user, cycle_id)


@router.get("/teams/{team_id}/velocity", response_model=Velocity)
def team_velocity(
    team_id: int,
    limit: int = Query(6, ge=1, le=24, description="How many recent cycles."),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Committed and completed points for recent completed cycles."""
    return reports_service.velocity(session, current_user, team_id, limit)


@router.get("/teams/{team_id}/cumulative-flow", response_model=CumulativeFlow)
def team_cumulative_flow(
    team_id: int,
    days: int = Query(30, ge=1, le=365),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Issue counts per status per day. Widening bands mean work is piling up."""
    return reports_service.cumulative_flow(session, current_user, team_id, days)


@router.get("/teams/{team_id}/created-vs-resolved", response_model=CreatedVsResolved)
def team_created_vs_resolved(
    team_id: int,
    days: int = Query(30, ge=1, le=365),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Issues opened against issues closed, with the running backlog."""
    return reports_service.created_vs_resolved(session, current_user, team_id, days)
