from fastapi import APIRouter, Depends
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_user
from lib_softtrack import outbound as outbound_service
from lib_softtrack.models.outbound import (
    OutboundWebhookCreate,
    OutboundWebhookCreated,
    OutboundWebhookRead,
    OutboundWebhookUpdate,
    WebhookDeliveryRead,
)
from lib_softtrack.tables import User
from web import get_session

# Outbound, to tell them apart from the GitHub and GitLab deliveries SoftTrack
# receives under /webhooks.
router = APIRouter(tags=["outbound webhooks"])


@router.get(
    "/teams/{team_id}/outbound-webhooks", response_model=list[OutboundWebhookRead]
)
def list_webhooks(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """The team's outbound webhooks. Team admins only."""
    return outbound_service.list_webhooks(session, current_user, team_id)


@router.post(
    "/teams/{team_id}/outbound-webhooks",
    response_model=OutboundWebhookCreated,
    dependencies=[team_writer],
)
def create_webhook(
    team_id: int,
    payload: OutboundWebhookCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Post chosen events to a URL, signed with `X-SoftTrack-Signature`.

    The URL must be public unless WEBHOOK_ALLOW_PRIVATE_TARGETS is set. The
    reply carries the signing secret -- the only time it is shown.
    """
    return outbound_service.create_webhook(session, current_user, team_id, payload)


@router.patch(
    "/outbound-webhooks/{webhook_id}",
    response_model=OutboundWebhookRead,
    dependencies=[team_writer],
)
def update_webhook(
    webhook_id: int,
    payload: OutboundWebhookUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return outbound_service.update_webhook(session, current_user, webhook_id, payload)


@router.delete(
    "/outbound-webhooks/{webhook_id}", status_code=204, dependencies=[team_writer]
)
def delete_webhook(
    webhook_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    outbound_service.delete_webhook(session, current_user, webhook_id)


@router.get(
    "/outbound-webhooks/{webhook_id}/deliveries",
    response_model=list[WebhookDeliveryRead],
)
def list_deliveries(
    webhook_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """The latest deliveries, newest first, with the receiver's answer."""
    return outbound_service.list_deliveries(session, current_user, webhook_id)


@router.post(
    "/outbound-webhooks/{webhook_id}/ping", status_code=202, dependencies=[team_writer]
)
def ping_webhook(
    webhook_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Queue a `ping` delivery, to check the URL and the secret."""
    outbound_service.ping(session, current_user, webhook_id)
