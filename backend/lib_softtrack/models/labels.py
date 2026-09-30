from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

#: A label's colour, as the palette and the API write it.
HEX_COLOR = r"^#[0-9a-fA-F]{6}$"


class LabelCreate(BaseModel):
    name: str
    color: str = Field(default="#94a3b8", pattern=HEX_COLOR)


class LabelUpdate(BaseModel):
    """A rename or a new colour (#321). Tickets point at the row, so both
    follow every ticket that carries the label."""

    name: Optional[str] = None
    color: Optional[str] = Field(default=None, pattern=HEX_COLOR)


class LabelRead(BaseModel):
    id: int
    team_id: int
    name: str
    color: str

    model_config = ConfigDict(from_attributes=True)


class NamedRef(BaseModel):
    id: int
    name: str


class LabelUsage(BaseModel):
    """What points at one label: shown beside it in settings, and counted
    before it is deleted, so nothing is left filtering by a label that has
    gone (#321)."""

    label_id: int
    ticket_count: int
    #: Saved views that filter by it, among the ones the caller can see.
    views: list[NamedRef]
    #: Other people's private views that filter by it, counted, not named.
    hidden_view_count: int
    #: Automation rules that name it, as a condition or as the label to add.
    rules: list[NamedRef]
