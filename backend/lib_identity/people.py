"""The people directory (#125): every active account, for anyone signed in.

Instance-wide on purpose, unlike `@mention` resolution, which stays per team:
a directory of the people you already share a team with would not be a
directory. Deactivated accounts are not listed, the same as in assignee
pickers; the admin user directory is where those are seen and managed.

Filtered and paged in the database from the start. Filtering the loaded page
in the browser is a different, worse feature, as the board's filters found.
"""

from typing import Optional

from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, func, or_, select

from lib_identity.models.identity import PersonRef
from lib_identity.models.people import PeoplePage, PersonRead
from lib_softtrack.models.page import DEFAULT_LIMIT
from lib_softtrack.tables import User


def find_by_username(session: Session, username: str) -> Optional[User]:
    return session.exec(
        select(User).where(func.lower(User.username) == username.strip().lower())
    ).first()


def list_people(
    session: Session,
    q: Optional[str] = None,
    department_id: Optional[int] = None,
    manager: Optional[str] = None,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> PeoplePage:
    filters = [User.is_active == True]  # noqa: E712 -- SQL comparison
    if q and q.strip():
        needle = f"%{q.strip()}%"
        filters.append(
            or_(
                col(User.full_name).ilike(needle),
                col(User.username).ilike(needle),
                col(User.job_title).ilike(needle),
            )
        )
    if department_id is not None:
        filters.append(User.department_id == department_id)

    manager_row = None
    if manager:
        manager_row = find_by_username(session, manager)
        if manager_row is None:
            # A link to somebody who is not here any more matches nobody,
            # rather than quietly dropping the filter and showing everyone.
            return PeoplePage(items=[], total=0, limit=limit, offset=offset)
        filters.append(User.manager_id == manager_row.id)

    total = session.exec(select(func.count()).select_from(User).where(*filters)).one()
    people = session.exec(
        select(User)
        .where(*filters)
        # Departments and managers for the page in a query each, not per row.
        .options(selectinload(User.department), selectinload(User.manager))
        .order_by(func.lower(User.full_name), User.id)
        .limit(limit)
        .offset(offset)
    ).all()

    return PeoplePage(
        items=[PersonRead.model_validate(person) for person in people],
        total=total,
        limit=limit,
        offset=offset,
        manager=PersonRef.model_validate(manager_row) if manager_row else None,
    )
