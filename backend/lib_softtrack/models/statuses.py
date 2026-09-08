from typing import Optional

from pydantic import BaseModel, Field

from lib_softtrack.tables import StatusCategory


class StatusRead(BaseModel):
    """A team's status, as everything that renders an issue receives it.

    Embedded in IssueRead rather than referenced by id: a search hit and a
    linked issue are both drawn outside any team's board, where there is no
    status list on hand to look the id up in.
    """

    id: int
    team_id: int
    name: str
    category: StatusCategory
    position: int
    color: str

    class Config:
        from_attributes = True


class StatusCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    category: StatusCategory
    color: str = "#9b98b0"


class StatusUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=40)
    #: Recategorising is allowed and is a real edit: moving "QA" from started
    #: to done changes what every report says about the work sitting in it.
    category: Optional[StatusCategory] = None
    color: Optional[str] = None


class StatusOrder(BaseModel):
    """The team's statuses, in the order the board should show them.

    Every id at once rather than one move at a time: two people dragging
    columns would otherwise interleave into an order neither of them chose.
    """

    status_ids: list[int]


class StatusDelete(BaseModel):
    """Where the issues in the status being deleted should go.

    Required rather than defaulted. Issues are the point of the tracker, and
    guessing which column somebody's work should land in is not a decision to
    make on their behalf.
    """

    move_to_id: int
