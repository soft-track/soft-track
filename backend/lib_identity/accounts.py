"""Accounts a site admin creates for somebody (#303).

Registration is a door for strangers: throttled per address, and closed when
`OPEN_REGISTRATION` is off. A new hire is not a stranger, and until now there
was no other door -- so their account could not be prepared before they
arrived, with a department, a manager and teams, and work waiting for them.

The account is created without a password. Its owner chooses one from a link,
made by the machinery "Forgot password" uses (`password_reset.issue_link`):
one live link per account, only its hash stored, spent once used. It lasts as
long as an invitation does. With SMTP configured the link is emailed; either
way the admin is handed it to copy, as with an invitation. Nobody but the
owner ever knows the password.

Until the owner chooses one the account is "not yet activated": it can be
assigned work and mentioned like anybody on its teams, and the directory and
the pickers say it has not been signed into yet.
"""

import logging
from datetime import timedelta
from typing import Optional

from sqlmodel import Session, col, select

from lib_identity import managers, password_reset
from lib_identity.departments import require_department
from lib_identity.identity import create_user, find_user_by_email
from lib_identity.models.admin import (
    AdminUserCreate,
    AdminUserCreated,
    WelcomeLinkCreated,
    WelcomeLinkRead,
)
from lib_identity.usernames import assert_username_free, normalise_username
from lib_softtrack.tables import PasswordReset, TeamMember, TeamRole, User, utcnow
from lib_softtrack.teams import get_team_or_404
from lib_utils.errors import ErrorCode, api_error
from lib_utils.password import unusable_password
from web import settings

# "uvicorn.error" for the reason lib_finance/access.py gives. Until the audit
# log (#302) exists, a line here is the record.
logger = logging.getLogger("uvicorn.error")

Message = tuple[str, str, str]


def _record(event: str, actor: User, user: User) -> None:
    """account.created at=2026-10-12T10:14:03Z by=sofia account=yuki"""
    logger.info(
        "account.%s at=%s by=%s account=%s",
        event,
        utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        actor.username,
        user.username,
    )


def _require_mail(send_email: bool) -> None:
    if send_email and not settings.email_delivery_configured:
        raise api_error(
            status_code=400,
            code=ErrorCode.email_not_configured,
            detail="This instance cannot send email. Copy the link instead.",
        )


def _link_url(token: str) -> str:
    return f"{settings.app_base_url.rstrip('/')}/welcome/{token}"


def _email(user: User, actor: User, link: str, expires_at) -> Message:
    """Plain text, like the invitation, for somebody who may never have heard
    of SoftTrack."""
    until = f"{expires_at.day} {expires_at:%B}"
    body = (
        f"Hi {user.full_name},\n\n"
        f"{actor.full_name} made an account for you on {settings.app_name}, "
        f"with the username @{user.username}. Choose a password to sign in:\n\n"
        f"{link}\n\n"
        f"The link works once, until {until}. After that, ask "
        f"{actor.full_name} for a new one.\n"
    )
    return user.email, f"Your {settings.app_name} account is ready", body


def _issue(
    session: Session, actor: User, user: User, send_email: bool
) -> tuple[WelcomeLinkCreated, Optional[Message]]:
    token, row = password_reset.issue_link(
        session,
        user,
        timedelta(days=settings.invite_expire_days),
        emailed=send_email,
    )
    session.commit()
    session.refresh(row)
    link = _link_url(token)
    message = _email(user, actor, link, row.expires_at) if send_email else None
    return (
        WelcomeLinkCreated(
            link=link,
            welcome_link=WelcomeLinkRead.model_validate(row, from_attributes=True),
        ),
        message,
    )


def create_account(
    session: Session, actor: User, payload: AdminUserCreate
) -> tuple[AdminUserCreated, Optional[Message]]:
    """Create the account, and its first link. Returns the message to send,
    if one was asked for, for the caller to send after responding."""
    from lib_identity.admin import user_read
    from lib_softtrack.invites import invited_from_outside

    _require_mail(payload.send_email)

    full_name = payload.full_name.strip()
    if not full_name:
        raise api_error(
            status_code=400,
            code=ErrorCode.name_required,
            detail="A name cannot be empty",
        )
    email = str(payload.email).strip().lower()
    if find_user_by_email(session, email):
        raise api_error(
            status_code=400,
            code=ErrorCode.email_taken,
            detail="Email already registered",
        )
    username = (payload.username or "").strip() or None
    if username is not None:
        assert_username_free(session, normalise_username(username))

    # Everything checked before the row exists, so a refusal leaves nothing
    # half-made behind.
    if payload.department_id is not None:
        require_department(session, payload.department_id)
    if payload.manager_id is not None:
        manager = session.get(User, payload.manager_id)
        if manager is None:
            raise api_error(
                status_code=400, code=ErrorCode.user_not_found, detail="No such person"
            )
    teams = {}
    for place in payload.teams:
        teams[place.team_id] = (get_team_or_404(place.team_id, session), place.role)
    # A live invitation from outside makes the account external (#243), and
    # somebody from outside is only ever a guest.
    if invited_from_outside(session, email) and any(
        role != TeamRole.guest for _, role in teams.values()
    ):
        raise api_error(
            status_code=400,
            code=ErrorCode.external_account_is_guest,
            detail="Somebody from outside the organisation can only be a guest",
        )

    user = create_user(
        session,
        email=email,
        full_name=full_name,
        hashed_password=unusable_password(),
        username=username,
        activated=False,
    )
    user.job_title = (payload.job_title or "").strip() or None
    user.started_on = payload.started_on
    user.department_id = payload.department_id
    # Refuses a deactivated manager. A loop is impossible: nobody reports to
    # an account that did not exist a moment ago.
    managers.set_manager(session, user, payload.manager_id)
    for team, role in teams.values():
        session.add(TeamMember(team_id=team.id, user_id=user.id, role=role))
    session.add(user)
    session.commit()
    session.refresh(user)
    _record("created", actor, user)

    created, message = _issue(session, actor, user, payload.send_email)
    return (
        AdminUserCreated(
            link=created.link,
            welcome_link=created.welcome_link,
            user=user_read(session, user),
        ),
        message,
    )


def new_link(
    session: Session, actor: User, user_id: int, send_email: bool
) -> tuple[WelcomeLinkCreated, Optional[Message]]:
    """A fresh link for an account not yet activated. The one before stops
    working: only one is ever live."""
    from lib_identity.admin import get_user_or_404

    _require_mail(send_email)
    user = get_user_or_404(session, user_id)
    if user.is_activated:
        raise api_error(
            status_code=409,
            code=ErrorCode.account_already_activated,
            detail=f"{user.full_name} has already chosen a password",
        )
    if not user.is_active:
        raise api_error(
            status_code=400,
            code=ErrorCode.account_deactivated,
            detail="This account has been deactivated",
        )
    created, message = _issue(session, actor, user, send_email)
    _record("link_sent" if send_email else "link_copied", actor, user)
    return created, message


def live_links(session: Session, user_ids: list[int]) -> dict[int, WelcomeLinkRead]:
    """The live link of each of these accounts that has one, in one query."""
    if not user_ids:
        return {}
    rows = session.exec(
        select(PasswordReset).where(
            col(PasswordReset.user_id).in_(user_ids),
            PasswordReset.expires_at > utcnow(),
        )
    ).all()
    return {
        row.user_id: WelcomeLinkRead.model_validate(row, from_attributes=True)
        for row in rows
    }
