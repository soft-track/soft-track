"""Departments (#123): a flat list of named groups that a site admin defines.

Anyone signed in can read the list. The people directory filters by it, and a
department's name is no secret from the people who work in it. Only a site
admin creates, renames or deletes one, and puts people in one from the user
directory (see `lib_identity/admin.py`).
"""

from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, select

from lib_identity.models.departments import (
    DepartmentCreate,
    DepartmentDelete,
    DepartmentRead,
    DepartmentUpdate,
)
from lib_softtrack.tables import Department, User
from lib_utils.errors import ErrorCode, api_error


def list_departments(session: Session) -> list[DepartmentRead]:
    departments = session.exec(
        select(Department).order_by(Department.name_key, Department.id)
    ).all()
    # One grouped count for the whole list rather than one per department.
    counts = dict(
        session.exec(
            select(User.department_id, func.count())
            .where(col(User.department_id).is_not(None))
            .group_by(User.department_id)
        ).all()
    )
    return [
        _to_read(department, counts.get(department.id, 0)) for department in departments
    ]


def _to_read(department: Department, member_count: int) -> DepartmentRead:
    return DepartmentRead(
        id=department.id,
        name=department.name,
        description=department.description,
        member_count=member_count,
    )


def get_department_or_404(session: Session, department_id: int) -> Department:
    department = session.get(Department, department_id)
    if department is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.department_not_found,
            detail="Department not found",
        )
    return department


def require_department(session: Session, department_id: int) -> Department:
    """A department named in a request body, which is a 400 when it is missing.

    Distinct from `get_department_or_404`: the thing the request is *about*
    exists, and it is one of the values sent with it that does not.
    """
    department = session.get(Department, department_id)
    if department is None:
        raise api_error(
            status_code=400,
            code=ErrorCode.department_not_found,
            detail="No such department",
        )
    return department


def _required_name(name: str) -> str:
    name = name.strip()
    if not name:
        raise api_error(
            status_code=400,
            code=ErrorCode.name_required,
            detail="A department needs a name",
        )
    return name


def _name_key(name: str) -> str:
    """What makes two names the same department: `Department.name_key`."""
    return name.casefold()


def _assert_name_free(
    session: Session, name: str, except_id: Optional[int] = None
) -> None:
    """Refuse a name another department has, in any case."""
    statement = select(Department).where(Department.name_key == _name_key(name))
    if except_id is not None:
        statement = statement.where(Department.id != except_id)
    existing = session.exec(statement).first()
    if existing is not None:
        raise api_error(
            status_code=400,
            code=ErrorCode.department_name_taken,
            detail=f"“{existing.name}” already exists. Department names are "
            "unique, whatever the case.",
        )


def _optional_text(value: Optional[str]) -> Optional[str]:
    return (value or "").strip() or None


def _member_count(session: Session, department_id: int) -> int:
    return session.exec(
        select(func.count())
        .select_from(User)
        .where(User.department_id == department_id)
    ).one()


def _commit_name(session: Session, name: str, except_id: Optional[int] = None) -> None:
    """Commit a new or renamed department, naming the clash if it lost a race.

    The check before it covers the ordinary case. Two admins creating the same
    name at once both pass it, and the unique key refuses the second; this
    turns that into the same sentence the check would have given.
    """
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        _assert_name_free(session, name, except_id=except_id)
        raise


def create_department(session: Session, payload: DepartmentCreate) -> DepartmentRead:
    name = _required_name(payload.name)
    _assert_name_free(session, name)
    department = Department(
        name=name,
        name_key=_name_key(name),
        description=_optional_text(payload.description),
    )
    session.add(department)
    _commit_name(session, name)
    session.refresh(department)
    return _to_read(department, 0)


def update_department(
    session: Session, department_id: int, payload: DepartmentUpdate
) -> DepartmentRead:
    department = get_department_or_404(session, department_id)
    if payload.name is not None:
        name = _required_name(payload.name)
        # Excluding itself, so "engineering" can become "Engineering".
        _assert_name_free(session, name, except_id=department.id)
        department.name = name
        department.name_key = _name_key(name)
    if "description" in payload.model_fields_set:
        department.description = _optional_text(payload.description)
    session.add(department)
    _commit_name(session, department.name, except_id=department_id)
    session.refresh(department)
    return _to_read(department, _member_count(session, department.id))


def delete_department(
    session: Session, department_id: int, payload: Optional[DepartmentDelete]
) -> None:
    """Delete a department, first moving anybody in it where the admin said.

    Never a silent cascade. People in it are moved to the department the
    request names, or to none when it says null -- and when it says nothing,
    the delete is refused, the same way deleting a status asks where its
    tickets go. Deactivated accounts count: they point at the row as much as
    anybody. A department with nobody in it just goes.
    """
    department = get_department_or_404(session, department_id)
    members = session.exec(
        select(User).where(User.department_id == department.id)
    ).all()

    if members:
        if payload is None:
            raise api_error(
                status_code=409,
                code=ErrorCode.department_not_empty,
                detail=f"{department.name} has people in it. Say which department "
                "they move to, or none.",
            )
        if payload.move_to_id == department.id:
            raise api_error(
                status_code=400,
                code=ErrorCode.department_move_to_same,
                detail="Move its people to a different department",
            )
        if payload.move_to_id is not None:
            require_department(session, payload.move_to_id)
        for member in members:
            member.department_id = payload.move_to_id
            session.add(member)
        # The moves reach the database before the row they stopped pointing
        # at is deleted, whatever order the unit of work would pick.
        session.flush()

    session.delete(department)
    session.commit()
