from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from lib_identity.identity import get_current_insider, get_current_user
from lib_softtrack import my_work as my_work_service
from lib_softtrack import workload as workload_service
from lib_softtrack.models.my_work import MyWorkGrouping, MyWorkRead, MyWorkTab
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
    viewer: User = Depends(get_current_insider),
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


# My work (#258): the same query, turned round to face its owner.
me_router = APIRouter(prefix="/me", tags=["my work"])


@me_router.get("/work", response_model=MyWorkRead)
def get_my_work(
    tab: MyWorkTab = Query(default=MyWorkTab.assigned),
    grouping: MyWorkGrouping = Query(default=MyWorkGrouping.team),
    per_team: int = Query(default=5, ge=1, le=MAX_LIMIT),
    team_id: Optional[int] = Query(
        default=None, description="Only this team's group, for its next page"
    ),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=MAX_LIMIT, description="As one list"),
    today: Optional[date] = Query(
        default=None,
        description=(
            "The viewer's today, for what is overdue or due soon. Defaults to "
            "today in UTC; a client should send its local date."
        ),
    ),
    session: Session = Depends(get_session),
    viewer: User = Depends(get_current_user),
):
    """Everything open that is yours, across every team you are on.

    `tab` says whose: assigned to you, the tickets you watch, the ones you
    created. By team, each team has its count and points summed by the
    database and a page of tickets; pass `team_id` and `offset` for a group's
    next page. As one list (`grouping=none`), `tickets` is a page of it.
    On Assigned to me, what is overdue or due in the next three days is in
    `due`, and left out of the groups and the list. `waiting` holds
    invitations to you and requests to join the teams you run.

    An account from outside the organisation sees its epics only, as
    everywhere; teams you are not on, and archived teams, are not counted.
    """
    return my_work_service.my_work(
        session,
        viewer,
        tab=tab,
        grouping=grouping,
        per_team=per_team,
        team_id=team_id,
        offset=offset,
        limit=limit,
        today=today,
    )
