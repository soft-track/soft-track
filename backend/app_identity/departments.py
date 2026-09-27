from typing import Optional

from fastapi import APIRouter, Body, Depends, Response
from sqlmodel import Session

from lib_identity import departments as departments_service
from lib_identity.admin import require_site_admin
from lib_identity.identity import get_current_user
from lib_identity.models.departments import (
    DepartmentCreate,
    DepartmentDelete,
    DepartmentRead,
    DepartmentUpdate,
)
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(prefix="/departments", tags=["departments"])


@router.get("", response_model=list[DepartmentRead])
def list_departments(
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """Every department, by name, with how many people are in each.

    Open to anyone signed in, not just site admins: the people directory
    filters by department, and a department's name is not a secret from the
    people who work in it.
    """
    return departments_service.list_departments(session)


@router.post("", response_model=DepartmentRead)
def create_department(
    payload: DepartmentCreate,
    session: Session = Depends(get_session),
    _: User = Depends(require_site_admin),
):
    """Add a department. Names are unique whatever the case."""
    return departments_service.create_department(session, payload)


@router.patch("/{department_id}", response_model=DepartmentRead)
def update_department(
    department_id: int,
    payload: DepartmentUpdate,
    session: Session = Depends(get_session),
    _: User = Depends(require_site_admin),
):
    """Rename a department or change its description.

    A rename follows everybody in it: they point at the department, not at
    its name.
    """
    return departments_service.update_department(session, department_id, payload)


# The body is optional, unlike deleting a status: an empty department has
# nobody to move, so there is nothing to choose. When somebody is in it, the
# body is how the admin says where they go, and leaving it out is refused.
@router.delete("/{department_id}", status_code=204)
def delete_department(
    department_id: int,
    payload: Optional[DepartmentDelete] = Body(default=None),
    session: Session = Depends(get_session),
    _: User = Depends(require_site_admin),
):
    """Delete a department, moving its people where `move_to_id` says.

    `move_to_id` is another department, or null for none. Required only when
    somebody is in it -- including deactivated accounts, which still point at
    it -- and a 409 `department_not_empty` when it is missing.
    """
    departments_service.delete_department(session, department_id, payload)
    return Response(status_code=204)
