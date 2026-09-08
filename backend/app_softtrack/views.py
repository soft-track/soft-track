from fastapi import APIRouter, Depends
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack import views as views_service
from lib_softtrack.models.views import (
    DefaultViewUpdate,
    SavedViewCreate,
    SavedViewRead,
    SavedViews,
    SavedViewUpdate,
)
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["views"])


@router.get("/teams/{team_id}/views", response_model=SavedViews)
def list_views(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Every view this person can see on the team, plus which one is default.

    Not paginated. A team that has more saved views than fit in one response
    has a different problem, and the sidebar renders all of them at once.
    """
    return views_service.list_views(session, current_user, team_id)


@router.post("/teams/{team_id}/views", response_model=SavedViewRead)
def create_view(
    team_id: int,
    payload: SavedViewCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return views_service.create_view(session, current_user, team_id, payload)


# Above /teams/{team_id}/views/{view_id} would be ambiguous, so the per-view
# routes hang off /views instead: a view id is unique without its team.
@router.patch("/views/{view_id}", response_model=SavedViewRead)
def update_view(
    view_id: int,
    payload: SavedViewUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return views_service.update_view(session, current_user, view_id, payload)


@router.delete("/views/{view_id}", status_code=204)
def delete_view(
    view_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    views_service.delete_view(session, current_user, view_id)


@router.put("/teams/{team_id}/default-view", response_model=SavedViews)
def set_team_default_view(
    team_id: int,
    payload: DefaultViewUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Where everyone on the team lands. Team admins only, shared views only.

    Returns the whole list rather than the view, because setting a default
    also unsets the previous one and the sidebar has to redraw both.
    """
    return views_service.set_team_default(session, current_user, team_id, payload)


@router.put("/teams/{team_id}/default-view/me", response_model=SavedViews)
def set_my_default_view(
    team_id: int,
    payload: DefaultViewUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Where *you* land on this team, overriding the team's default.

    Clearing it falls back to the team's rather than to all issues: no
    override means no preference, not a preference for nothing.
    """
    return views_service.set_my_default(session, current_user, team_id, payload)
