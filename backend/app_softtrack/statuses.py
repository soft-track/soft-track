from fastapi import APIRouter, Depends
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack import statuses as statuses_service
from lib_softtrack.models.statuses import (
    StatusCreate,
    StatusDelete,
    StatusOrder,
    StatusRead,
    StatusUpdate,
)
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["statuses"])


@router.get("/teams/{team_id}/statuses", response_model=list[StatusRead])
def list_statuses(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """The team's board columns, in order. Any member may read them."""
    return statuses_service.list_statuses(session, current_user, team_id)


@router.post("/teams/{team_id}/statuses", response_model=StatusRead)
def create_status(
    team_id: int,
    payload: StatusCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Add a column. Team admins only.

    Unlike labels and projects, which any member creates: this is the shape of
    everybody's board and the vocabulary every report is written in.
    """
    return statuses_service.create_status(session, current_user, team_id, payload)


@router.put("/teams/{team_id}/statuses/order", response_model=list[StatusRead])
def reorder_statuses(
    team_id: int,
    payload: StatusOrder,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Set the board order. Takes every status at once -- see StatusOrder.

    Declared above `/statuses/{status_id}` so "order" is never read as an id.
    """
    return statuses_service.reorder_statuses(session, current_user, team_id, payload)


@router.patch("/statuses/{status_id}", response_model=StatusRead)
def update_status(
    status_id: int,
    payload: StatusUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return statuses_service.update_status(session, current_user, status_id, payload)


# A body on DELETE rather than a query parameter: where the issues go is not
# optional, and a required body is the shape that says so.
@router.delete("/statuses/{status_id}", response_model=list[StatusRead])
def delete_status(
    status_id: int,
    payload: StatusDelete,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Remove a column, moving its issues to another one.

    Returns the remaining statuses, because deleting one is the only operation
    whose result the board cannot work out for itself -- the issues moved.
    """
    return statuses_service.delete_status(session, current_user, status_id, payload)
