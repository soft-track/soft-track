from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from lib_identity.models.identity import UserPublic
from lib_softtrack.tables import IssueEventField


class IssueEventRead(BaseModel):
    """One change to one field of an issue, as the Activity feed shows it (#81).

    `old_value`/`new_value` are what the history stores: a status *category*
    (see `_status_category` in history.py), a priority, an estimate, or a
    row id. For the id fields -- assignee, cycle, project -- the labels carry
    the name it has now, or null when that row has since been deleted.
    """

    id: int
    field: IssueEventField
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    old_label: Optional[str] = None
    new_label: Optional[str] = None
    #: Null for a change nobody made by hand: an automation rule.
    actor: Optional[UserPublic] = None
    created_at: datetime
