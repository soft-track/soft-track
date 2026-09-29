from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.custom_fields import CustomFieldRef
from lib_softtrack.tables import TicketEventField


class TicketEventRead(BaseModel):
    """One change to one field of a ticket, as the Activity feed shows it (#81).

    `old_value`/`new_value` are what the history stores: a status *category*
    (see `_status_category` in history.py), a priority, an estimate, or a
    row id. For the id fields -- assignee, sprint, project -- the labels carry
    the name it has now, or null when that row has since been deleted.

    A change to one of the team's own fields (#117) is `custom_field`, with
    the field in `custom_field` and its values as the field stores them: a
    user id, an option id, a JSON list of option ids, `true`, a date or the
    text. Labels carry a person's or an option's name as it is now.
    """

    id: int
    field: TicketEventField
    custom_field: Optional[CustomFieldRef] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    old_label: Optional[str] = None
    new_label: Optional[str] = None
    #: Null for a change nobody made by hand: an automation rule.
    actor: Optional[UserPublic] = None
    created_at: datetime
