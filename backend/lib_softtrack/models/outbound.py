from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from lib_softtrack.tables import WebhookEvent


class OutboundWebhookCreate(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    events: list[WebhookEvent]
    #: Omitted: one is generated. Either way it is shown once, in the reply.
    secret: Optional[str] = Field(default=None, min_length=16, max_length=200)


class OutboundWebhookUpdate(BaseModel):
    url: Optional[str] = Field(default=None, min_length=1, max_length=2000)
    events: Optional[list[WebhookEvent]] = None
    #: Turning one back on clears the automatic switch-off and its count.
    is_enabled: Optional[bool] = None


class OutboundWebhookRead(BaseModel):
    id: int
    team_id: int
    url: str
    events: list[WebhookEvent]
    is_enabled: bool
    consecutive_failures: int
    #: Set when it was switched off automatically after repeated failures.
    disabled_reason: Optional[str] = None
    #: "whsec_…a1B2": enough to tell secrets apart, not to sign with.
    secret_hint: str
    created_at: datetime


class OutboundWebhookCreated(OutboundWebhookRead):
    """Returned once, when the webhook is made: the only time the secret is seen."""

    secret: str


class WebhookDeliveryRead(BaseModel):
    id: int
    event: str
    status: str
    attempts: int
    next_attempt_at: Optional[datetime] = None
    response_status: Optional[int] = None
    response_excerpt: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
