from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

#: Room for "Platform Engineering & Developer Experience"; short enough to fit
#: a chip in a directory row.
DEPARTMENT_NAME_MAX = 60
DEPARTMENT_DESCRIPTION_MAX = 200


class DepartmentRef(BaseModel):
    """A department as a profile shows it: enough to name it and filter by it."""

    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)


class DepartmentRead(DepartmentRef):
    description: Optional[str] = None
    #: Every account in it, deactivated ones included -- the people a delete
    #: would have to put somewhere else.
    member_count: int


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=DEPARTMENT_NAME_MAX)
    description: Optional[str] = Field(
        default=None, max_length=DEPARTMENT_DESCRIPTION_MAX
    )


class DepartmentUpdate(BaseModel):
    #: Renaming renames it for everyone in it: they point at the row.
    name: Optional[str] = Field(
        default=None, min_length=1, max_length=DEPARTMENT_NAME_MAX
    )
    #: Blank or null clears it; leaving it out leaves it alone.
    description: Optional[str] = Field(
        default=None, max_length=DEPARTMENT_DESCRIPTION_MAX
    )


class DepartmentDelete(BaseModel):
    """Where the people in a department go when it is deleted.

    Required and nullable: another department's id, or null for none. There
    is no default, so a client has to say which -- moving somebody out of
    their department is not a decision to make on the admin's behalf, the
    same way deleting a status asks where its tickets go. Only needed when
    somebody is in it; an empty department takes no body at all.
    """

    move_to_id: Optional[int]
