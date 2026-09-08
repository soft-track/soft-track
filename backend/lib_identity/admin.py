"""The site administrator's view of the instance: who has an account, and its state.

Instance-wide, and deliberately narrow. It can list accounts, turn them off
and back on, hand out its own privilege, and set a password for someone locked
out -- the four things a self-hosted install needs from somebody when there is
no support desk to call. It cannot delete a user: issues, comments and history
all point at the row, so removing it would either take that work with it or
leave the tracker unable to say who did what. Deactivation is the delete.
"""

from typing import Optional

from fastapi import Depends, HTTPException
from sqlmodel import Session, col, func, or_, select

from lib_identity.identity import get_current_user
from lib_identity.models.admin import AdminUserRead, AdminUserUpdate
from lib_identity.models.identity import UserMe
from lib_softtrack.models.page import DEFAULT_LIMIT, Page
from lib_softtrack.tables import TeamMember, User
from lib_utils.password import hash_password


def require_site_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_site_admin:
        raise HTTPException(
            status_code=403, detail="Only site administrators can do that"
        )
    return current_user


def _active_site_admin_count(session: Session) -> int:
    return session.exec(
        select(func.count())
        .select_from(User)
        .where(
            User.is_site_admin == True,  # noqa: E712 -- SQL comparison
            User.is_active == True,  # noqa: E712
        )
    ).one()


def list_users(
    session: Session,
    q: Optional[str] = None,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> Page[AdminUserRead]:
    filters = []
    if q:
        needle = f"%{q.strip()}%"
        filters.append(
            or_(
                col(User.email).ilike(needle),
                col(User.full_name).ilike(needle),
                col(User.username).ilike(needle),
            )
        )

    total = session.exec(select(func.count()).select_from(User).where(*filters)).one()

    users = session.exec(
        select(User)
        .where(*filters)
        .order_by(User.created_at, User.id)
        .limit(limit)
        .offset(offset)
    ).all()

    # One grouped count for the page rather than a query per row: the
    # directory is the one screen that shows every account at once, and the
    # per-row version is where that screen would get slow first.
    counts = dict(
        session.exec(
            select(TeamMember.user_id, func.count())
            .where(col(TeamMember.user_id).in_([u.id for u in users] or [0]))
            .group_by(TeamMember.user_id)
        ).all()
    )

    items = [_to_read(user, counts.get(user.id, 0)) for user in users]
    return Page(items=items, total=total, limit=limit, offset=offset)


def _to_read(user: User, team_count: int) -> AdminUserRead:
    # Built from UserMe rather than field by field, so a column added to the
    # user's own view of themselves shows up here without a second edit.
    return AdminUserRead(
        **UserMe.model_validate(user).model_dump(),
        last_login_at=user.last_login_at,
        team_count=team_count,
    )


def _get_user_or_404(session: Session, user_id: int) -> User:
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def update_user(
    session: Session, actor: User, user_id: int, payload: AdminUserUpdate
) -> AdminUserRead:
    user = _get_user_or_404(session, user_id)

    # Locking yourself out is never what was meant, and on a single-admin
    # instance it is unrecoverable without database access.
    if user.id == actor.id and payload.is_active is False:
        raise HTTPException(
            status_code=400, detail="You cannot deactivate your own account"
        )
    if user.id == actor.id and payload.is_site_admin is False:
        raise HTTPException(
            status_code=400, detail="You cannot remove your own site admin access"
        )

    # Unreachable as the rules stand, and kept anyway: the actor is
    # necessarily an active site admin, so any *other* active site admin makes
    # two, and the target being the actor is caught above. It is the net under
    # those two self-checks -- relax either of them and this is what stops the
    # instance being left with nobody who can administer it.
    losing_the_last_admin = (
        user.is_site_admin
        and user.is_active
        and (payload.is_site_admin is False or payload.is_active is False)
    )
    if losing_the_last_admin and _active_site_admin_count(session) <= 1:
        raise HTTPException(
            status_code=409,
            detail="This instance needs at least one active site administrator",
        )

    if payload.full_name is not None:
        name = payload.full_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="A name cannot be empty")
        user.full_name = name
    if payload.is_site_admin is not None:
        user.is_site_admin = payload.is_site_admin
    if payload.is_active is not None:
        if payload.is_active is False and user.is_active:
            # Deactivating has to end the sessions too, or the account keeps
            # working for up to a week on the token it already holds.
            user.token_version += 1
        user.is_active = payload.is_active

    session.add(user)
    session.commit()
    session.refresh(user)

    team_count = session.exec(
        select(func.count())
        .select_from(TeamMember)
        .where(TeamMember.user_id == user.id)
    ).one()
    return _to_read(user, team_count)


def reset_password(
    session: Session, actor: User, user_id: int, new_password: str
) -> None:
    """Set someone's password for them, for the locked-out colleague.

    No email round trip because there is no mail server; the administrator is
    trusted to hand the new password over in person or over whatever channel
    the team already uses. Every session the account had ends here, which is
    the right outcome whether the reset is routine or a response to a
    compromise.
    """
    user = _get_user_or_404(session, user_id)
    user.hashed_password = hash_password(new_password)
    user.token_version += 1
    session.add(user)
    session.commit()
