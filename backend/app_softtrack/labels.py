from typing import Optional

from fastapi import APIRouter, Depends, Query, Response
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_user
from lib_softtrack import labels as labels_service
from lib_softtrack.models.labels import LabelCreate, LabelRead, LabelUpdate, LabelUsage
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


@router.get("/teams/{team_id}/labels/usage", response_model=list[LabelUsage])
def label_usage(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """For each label, how many tickets carry it and which saved views and
    automation rules name it (#321)."""
    return labels_service.label_usage(session, current_user, team_id)


@router.patch(
    "/labels/{label_id}", response_model=LabelRead, dependencies=[team_writer]
)
def update_label(
    label_id: int,
    payload: LabelUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Rename or recolour a label; every ticket carrying it follows."""
    return labels_service.update_label(session, current_user, label_id, payload)


@router.delete("/labels/{label_id}", status_code=204, dependencies=[team_writer])
def delete_label(
    label_id: int,
    merge_into: Optional[int] = Query(
        None,
        description="Another of the team's labels to move its tickets, saved "
        "views and automation rules to. Left out, the label is taken off its "
        "tickets and views, and rules naming it are switched off.",
    ),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Delete a label. Team admins only."""
    labels_service.delete_label(session, current_user, label_id, merge_into)
    return Response(status_code=204)
