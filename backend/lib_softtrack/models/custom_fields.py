from datetime import datetime
from typing import Annotated, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from lib_identity.models.identity import UserPublic
from lib_softtrack.tables import CustomFieldKind, TicketType

#: What a key looks like: what a script would name a variable. Lowercase so
#: `Reviewer` and `reviewer` cannot both exist and be confused in a request.
KEY_PATTERN = r"^[a-z][a-z0-9_]{0,39}$"

#: The value one field has on a ticket, as the ticket is read. A person is
#: the whole `UserPublic` -- the way `assignee` is -- so a ticket names its
#: reviewer without the reader holding the team's member list; every other
#: kind is the value as stored. The field's kind says which of these it is.
CustomFieldValueRead = Union[StrictBool, int, float, str, list[str], UserPublic]

#: A value as it is written. A person is their user id, like `assignee_id`;
#: an option is its id (or its name); a date is `YYYY-MM-DD`. Null clears it.
CustomFieldInput = Optional[Union[StrictBool, int, float, str, list[str]]]

CustomFieldValues = Annotated[
    dict[str, CustomFieldInput],
    Field(
        description=(
            "Values for the team's own fields, by key. On an update only the "
            "keys given change, and null clears one."
        ),
    ),
]


class CustomFieldOption(BaseModel):
    """One choice a `select` or `multi_select` field offers.

    `id` is what a ticket's value stores. It is made from the option's first
    name and kept when the option is renamed, so renaming "prod" to
    "Production" does not change any ticket.
    """

    id: str
    name: str


class CustomFieldOptionWrite(BaseModel):
    """An option as an admin sends it. An existing option keeps its `id`; a
    new one leaves it out and is given one."""

    id: Optional[str] = None
    name: str = Field(min_length=1, max_length=40)


class CustomFieldRead(BaseModel):
    id: int
    team_id: int
    key: str
    name: str
    kind: CustomFieldKind
    options: list[CustomFieldOption]
    required: bool
    #: The ticket types it shows on; empty is every type.
    applies_to: list[TicketType]
    position: int
    #: When it was archived, or null. Archived fields keep their values,
    #: which tickets still show; nothing can change them.
    archived_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CustomFieldCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    #: Made from the name when left out. Fixed once the field exists.
    key: Optional[str] = Field(default=None, pattern=KEY_PATTERN)
    kind: CustomFieldKind
    #: Required for `select` and `multi_select`, refused for every other kind.
    options: list[CustomFieldOptionWrite] = Field(default=[], max_length=50)
    required: bool = False
    applies_to: list[TicketType] = []


class CustomFieldUpdate(BaseModel):
    """What an admin may change. Not the key and not the kind: both are what
    the values already written mean."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=40)
    #: The whole list, in order. An option left out is removed, and cleared
    #: from every ticket that had it.
    options: Optional[list[CustomFieldOptionWrite]] = Field(default=None, max_length=50)
    required: Optional[bool] = None
    applies_to: Optional[list[TicketType]] = None
    #: True archives it, false restores it.
    archived: Optional[bool] = None


class CustomFieldOrder(BaseModel):
    """Every field that is not archived, in the order tickets should show them.

    All at once, like `StatusOrder`. Archived fields keep their place, so
    restoring one puts it back where it was.
    """

    field_ids: list[int]


class CustomFieldRef(BaseModel):
    """Which field a history row is about, as it is named now."""

    id: int
    key: str
    name: str
    kind: CustomFieldKind
