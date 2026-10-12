from fastapi import APIRouter, Depends
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_insider, get_current_user
from lib_softtrack import capacity as capacity_service
from lib_softtrack.models.capacity import CapacityUpdate, SprintPlan
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["sprints"])


@router.get("/sprints/{sprint_id}/plan", response_model=SprintPlan)
def sprint_plan(
    sprint_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """What each person can take in the sprint against what they have (#269).

    A row per person who can be assigned the team's work -- not guests --
    with their capacity in points and in hours, a row for unassigned tickets,
    the scope beside the capacity, and the last three completed sprints'
    delivery as a line to plan against. Over capacity is shown, never refused.
    An account from outside the organisation is refused: it is about people.
    """
    return capacity_service.sprint_plan(session, current_user, sprint_id)


@router.put(
    "/sprints/{sprint_id}/capacity",
    response_model=SprintPlan,
    dependencies=[team_writer],
)
def set_capacity(
    sprint_id: int,
    payload: CapacityUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Set people's capacity in the sprint: the days they are away, and a
    capacity by hand in points or in minutes. Fields left out are left as
    they are; a capacity sent as null goes back to the team's default."""
    return capacity_service.set_capacity(session, current_user, sprint_id, payload)
