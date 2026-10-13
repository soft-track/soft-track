from fastapi import APIRouter, Depends
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_insider, get_current_user
from lib_softtrack import schedules as schedules_service
from lib_softtrack.models.schedules import ScheduleFields, ScheduleRead, ScheduleUpdate
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["schedules"])


@router.get("/teams/{team_id}/ticket-schedules", response_model=list[ScheduleRead])
def list_schedules(
    team_id: int,
    session: Session = Depends(get_session),
    # Not to an account from outside (#243): a schedule describes work
    # beyond the epics they were given, and lists the tickets it made.
    current_user: User = Depends(get_current_insider),
):
    """Every schedule on the team, paused or not (#264). Readable by every
    member, written by its admins."""
    return schedules_service.list_schedules(session, current_user, team_id)


@router.post(
    "/teams/{team_id}/ticket-schedules",
    response_model=ScheduleRead,
    dependencies=[team_writer],
)
def create_schedule(
    team_id: int,
    payload: ScheduleFields,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Add a schedule. Team admins only, like the automation rules."""
    return schedules_service.create_schedule(session, current_user, team_id, payload)


@router.patch(
    "/ticket-schedules/{schedule_id}",
    response_model=ScheduleRead,
    dependencies=[team_writer],
)
def update_schedule(
    schedule_id: int,
    payload: ScheduleUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Pause it, switch it back on, or rewrite it."""
    return schedules_service.update_schedule(
        session, current_user, schedule_id, payload
    )


@router.delete(
    "/ticket-schedules/{schedule_id}", status_code=204, dependencies=[team_writer]
)
def delete_schedule(
    schedule_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Remove a schedule. The tickets it made stay."""
    schedules_service.delete_schedule(session, current_user, schedule_id)
