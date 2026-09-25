from fastapi import APIRouter, Depends, Response
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_user
from lib_softtrack import templates as templates_service
from lib_softtrack.models.templates import (
    IssueTemplateCreate,
    IssueTemplateOrder,
    IssueTemplateRead,
    IssueTemplateUpdate,
)
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["templates"])


@router.get("/teams/{team_id}/issue-templates", response_model=list[IssueTemplateRead])
def list_templates(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """The team's description templates, in picker order. Any member may read."""
    return templates_service.list_templates(session, current_user, team_id)


@router.post(
    "/teams/{team_id}/issue-templates",
    response_model=IssueTemplateRead,
    dependencies=[team_writer],
)
def create_template(
    team_id: int,
    payload: IssueTemplateCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Add a template. Team admins only."""
    return templates_service.create_template(session, current_user, team_id, payload)


@router.put(
    "/teams/{team_id}/issue-templates/order",
    response_model=list[IssueTemplateRead],
    dependencies=[team_writer],
)
def reorder_templates(
    team_id: int,
    payload: IssueTemplateOrder,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Set the picker's order. Takes every template at once."""
    return templates_service.reorder_templates(session, current_user, team_id, payload)


@router.patch(
    "/issue-templates/{template_id}",
    response_model=IssueTemplateRead,
    dependencies=[team_writer],
)
def update_template(
    template_id: int,
    payload: IssueTemplateUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return templates_service.update_template(
        session, current_user, template_id, payload
    )


@router.delete(
    "/issue-templates/{template_id}", status_code=204, dependencies=[team_writer]
)
def delete_template(
    template_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    templates_service.delete_template(session, current_user, template_id)
    return Response(status_code=204)
