from fastapi import APIRouter, Depends
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_user
from lib_softtrack import labels as labels_service
from lib_softtrack.models.labels import LabelCreate, LabelRead
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["labels"])


@router.post(
    "/teams/{team_id}/labels", response_model=LabelRead, dependencies=[team_writer]
)
def create_label(
    team_id: int,
    payload: LabelCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return labels_service.create_label(session, current_user, team_id, payload)


@router.get("/teams/{team_id}/labels", response_model=list[LabelRead])
def list_labels(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return labels_service.list_labels(session, current_user, team_id)
