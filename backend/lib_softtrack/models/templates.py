from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class TicketTemplateRead(BaseModel):
    id: int
    team_id: int
    name: str
    #: Markdown, copied into the new ticket's description when chosen.
    body: str
    position: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TicketTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    body: str = Field(min_length=1)


class TicketTemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    body: Optional[str] = Field(default=None, min_length=1)


class TicketTemplateOrder(BaseModel):
    """Every template on the team, in the order the picker should list them.

    All of them at once, like `StatusOrder` and for the same reason: two admins
    dragging would otherwise interleave into an order neither chose.
    """

    template_ids: list[int]
