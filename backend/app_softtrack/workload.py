from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack import workload as workload_service
from lib_softtrack.models.page import MAX_LIMIT
from lib_softtrack.models.workload import WorkloadRead
from lib_softtrack.tables import User
from web import get_session

# Beside the profile it belongs to (`/users/{username}`, in app_identity),
# but here: it reads tickets, so it lives with the work.
router = APIRouter(prefix="/users", tags=["people"])


@router.get("/{username}/workload", response_model=WorkloadRead)
def get_workload(
    username: str,
    per_team: int = Query(default=5, ge=1, le=MAX_LIMIT),
    team_id: Optional[int] = Query(
        default=None, description="Only this team's group, for its next page"
    ),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
    viewer: User = Depends(get_current_user),
):
    """Everything open assigned to somebody, in the teams you share with them.

    Grouped by team, with each team's count and points summed by the
    database, and a page of its tickets. Pass `team_id` and `offset` for a
    group's next page. Done and cancelled work is not on anybody's plate, and
    tickets on a team you are not on are neither listed nor counted -- a site
    admin included.
    """
    return workload_service.workload(
        session, viewer, username, per_team=per_team, team_id=team_id, offset=offset
    )
