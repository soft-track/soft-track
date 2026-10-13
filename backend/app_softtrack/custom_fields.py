from fastapi import APIRouter, Depends
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_user
from lib_softtrack import custom_fields as custom_fields_service
from lib_softtrack.models.custom_fields import (
    CustomFieldCreate,
    CustomFieldOrder,
    CustomFieldRead,
    CustomFieldUpdate,
)
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["custom-fields"])


@router.get("/teams/{team_id}/custom-fields", response_model=list[CustomFieldRead])
def list_custom_fields(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """The team's own ticket fields (#117), archived ones included, in order.

    Any member may read them: they say what the keys in a ticket's
    `custom_fields` are and how to show their values.
    """
    return custom_fields_service.list_fields(session, current_user, team_id)


@router.post(
    "/teams/{team_id}/custom-fields",
    response_model=CustomFieldRead,
    dependencies=[team_writer],
)
def create_custom_field(
    team_id: int,
    payload: CustomFieldCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Add a field to the team's tickets. Team admins only."""
    return custom_fields_service.create_field(session, current_user, team_id, payload)


@router.put(
    "/teams/{team_id}/custom-fields/order",
    response_model=list[CustomFieldRead],
    dependencies=[team_writer],
)
def reorder_custom_fields(
    team_id: int,
    payload: CustomFieldOrder,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Set the order tickets show the fields in. Takes every field that is
    not archived, at once."""
    return custom_fields_service.reorder_fields(session, current_user, team_id, payload)


@router.patch(
    "/custom-fields/{field_id}",
    response_model=CustomFieldRead,
    dependencies=[team_writer],
)
def update_custom_field(
    field_id: int,
    payload: CustomFieldUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Rename, change the options, make required, bind to ticket types,
    archive or restore. Team admins only."""
    return custom_fields_service.update_field(session, current_user, field_id, payload)


@router.delete("/custom-fields/{field_id}", status_code=204, dependencies=[team_writer])
def delete_custom_field(
    field_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Destroy an archived field, with every value and history row it has.

    Refused for a field that is not archived: archiving is how a field is
    retired, and this is the separate, louder step past it.
    """
    custom_fields_service.delete_field(session, current_user, field_id)
