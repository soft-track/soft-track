"""Finding a team and asking to join it (#259).

A team used to be invisible until you were on it, and the only way onto one
was an invitation an admin thought to send. Now the team directory lists the
teams there are, and from it you ask to join one, with an optional note. The
team's admins are told -- by email where this instance sends it, and under
Settings -> Members either way -- and approve with a role or decline.

One open request per person per team, and it runs out after the days an
invitation does. A team can keep itself off the directory, and a team can be
open: anybody signed in joins it as a member without asking. An account from
outside the organisation (#243) does neither; it waits to be invited.
"""

from datetime import timedelta
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, delete, select

from lib_identity.models.identity import UserPublic
from lib_softtrack import outside
from lib_softtrack.models.teams import (
    JoinRequestApprove,
    JoinRequestCreate,
    JoinRequestRead,
    MyJoinRequest,
    TeamMemberRead,
)
from lib_softtrack.tables import (
    Team,
    TeamJoinRequest,
    TeamMember,
    TeamRole,
    User,
    utcnow,
)
from lib_softtrack.teams import (
    get_team_or_404,
    is_team_member,
    list_members_of,
    require_team_admin,
)
from lib_utils.errors import ErrorCode, api_error

#: A message to send after the response: recipient, subject, body.
Message = tuple[str, str, str]


def _expiry():
    from web import settings

    return utcnow() + timedelta(days=settings.invite_expire_days)


def _link(path: str) -> str:
    from web import settings

    return f"{settings.app_base_url.rstrip('/')}{path}"


def prune_expired(session: Session) -> None:
    """Delete requests that have run out. On read, as invitations are: there
    is no scheduler, and expired rows are only in the way of these queries."""
    session.exec(
        delete(TeamJoinRequest)
        .where(TeamJoinRequest.expires_at <= utcnow())
        .execution_options(synchronize_session="fetch")
    )
    session.commit()


def forget(session: Session, team_id: int, user_id: int) -> None:
    """Somebody is on the team now, however they got there: a request of
    theirs to join it has nothing left to ask. Not committed."""
    session.exec(
        delete(TeamJoinRequest).where(
            TeamJoinRequest.team_id == team_id,
            TeamJoinRequest.requester_id == user_id,
        )
    )


def _findable(session: Session, team_id: int) -> Team:
    """A team somebody not on it may ask to join: in use, and on the list.

    An archived team and one that keeps itself off the list answer as if
    there were no such team, so a guessed id says nothing about either.
    """
    team = get_team_or_404(team_id, session)
    if team.archived_at is not None or not team.listed:
        raise api_error(
            status_code=404, code=ErrorCode.team_not_found, detail="Team not found"
        )
    return team


def _refuse_members(session: Session, team_id: int, user: User) -> None:
    if is_team_member(team_id, user.id, session):
        raise api_error(
            status_code=400,
            code=ErrorCode.already_member,
            detail="You are on this team already",
        )


def _active_admins(session: Session, team_id: int) -> list[User]:
    return list(
        session.exec(
            select(User)
            .join(TeamMember, TeamMember.user_id == User.id)
            .where(
                TeamMember.team_id == team_id,
                TeamMember.role == TeamRole.admin,
                User.is_active == True,  # noqa: E712 -- SQL comparison
            )
            .order_by(TeamMember.joined_at)
        ).all()
    )


# --- the person asking -------------------------------------------------------


def ask_to_join(
    session: Session, user: User, team_id: int, payload: JoinRequestCreate
) -> tuple[MyJoinRequest, list[Message]]:
    """Ask to join a team. Returns the request and a message for each of the
    team's admins, which the caller sends after responding."""
    from web import settings

    team = _findable(session, team_id)
    _refuse_members(session, team_id, user)
    prune_expired(session)

    note = (payload.note or "").strip() or None
    request = TeamJoinRequest(
        team_id=team_id, requester_id=user.id, note=note, expires_at=_expiry()
    )
    session.add(request)
    try:
        session.commit()
    except IntegrityError:
        # The unique constraint, which also settles two tabs asking at once.
        session.rollback()
        raise api_error(
            status_code=409,
            code=ErrorCode.join_request_pending,
            detail="You have asked to join this team already",
        )
    session.refresh(request)

    subject = f"{user.full_name} asks to join {team.name} on {settings.app_name}"
    body = f"{user.full_name} ({user.email}) asks to join {team.name} · {team.key}.\n\n"
    if note:
        body += f"“{note}”\n\n"
    expires = f"{request.expires_at.day} {request.expires_at:%B %Y}"
    body += (
        f"Approve or decline it here:\n"
        f"{_link(f'/settings/teams/{team.key}/members')}\n\n"
        f"The request runs out on {expires}.\n"
    )
    messages = [
        (admin.email, subject, body) for admin in _active_admins(session, team_id)
    ]
    return MyJoinRequest.model_validate(request), messages


def join_open_team(session: Session, user: User, team_id: int) -> Team:
    """Join a team that is open to join, as a member, without asking."""
    team = _findable(session, team_id)
    _refuse_members(session, team_id, user)
    if not team.open_to_join:
        raise api_error(
            status_code=400,
            code=ErrorCode.team_not_open,
            detail="This team takes requests to join; ask instead",
        )
    session.add(TeamMember(team_id=team_id, user_id=user.id, role=TeamRole.member))
    forget(session, team_id, user.id)
    session.commit()
    session.refresh(team)
    return team


def _not_found() -> None:
    raise api_error(
        status_code=404,
        code=ErrorCode.join_request_not_found,
        detail="Request not found",
    )


def withdraw(session: Session, user: User, request_id: int) -> None:
    """Withdraw your own request. Somebody else's answers as if there were none."""
    request = session.get(TeamJoinRequest, request_id)
    if request is None or request.requester_id != user.id:
        _not_found()
    session.delete(request)
    session.commit()


# --- the team's admins -------------------------------------------------------


def _read(request: TeamJoinRequest, requester: User) -> JoinRequestRead:
    return JoinRequestRead(
        id=request.id,
        team_id=request.team_id,
        requester=UserPublic.model_validate(requester),
        job_title=requester.job_title,
        department=requester.department.name if requester.department else None,
        manager=(
            UserPublic.model_validate(requester.manager) if requester.manager else None
        ),
        note=request.note,
        created_at=request.created_at,
        expires_at=request.expires_at,
    )


def list_requests(session: Session, admin: User, team_id: int) -> list[JoinRequestRead]:
    """The requests waiting on a team, oldest first. Its admins only."""
    get_team_or_404(team_id, session)
    require_team_admin(team_id, admin, session)
    prune_expired(session)
    rows = session.exec(
        select(TeamJoinRequest, User)
        .join(User, User.id == TeamJoinRequest.requester_id)
        .where(
            TeamJoinRequest.team_id == team_id,
            # A deactivated account could not use the place it asked for.
            User.is_active == True,  # noqa: E712 -- SQL comparison
        )
        .order_by(TeamJoinRequest.created_at, TeamJoinRequest.id)
    ).all()
    return [_read(request, requester) for request, requester in rows]


def _live_request(session: Session, team_id: int, request_id: int) -> TeamJoinRequest:
    # The team is part of the lookup: an admin of one team does not decide
    # another's requests by guessing a number. The expiry is in SQL, where
    # both sides are UTC (see invites._live_invite_or_404).
    request = session.exec(
        select(TeamJoinRequest).where(
            TeamJoinRequest.id == request_id,
            TeamJoinRequest.team_id == team_id,
            TeamJoinRequest.expires_at > utcnow(),
        )
    ).first()
    if request is None:
        _not_found()
    return request


def approve(
    session: Session,
    admin: User,
    team_id: int,
    request_id: int,
    payload: JoinRequestApprove,
) -> tuple[TeamMemberRead, Optional[Message]]:
    """Put the person on the team with the role chosen, and tell them."""
    from web import settings

    team = get_team_or_404(team_id, session)
    require_team_admin(team_id, admin, session)
    request = _live_request(session, team_id, request_id)
    requester = session.get(User, request.requester_id)
    if not requester.is_active:
        raise api_error(
            status_code=400,
            code=ErrorCode.account_deactivated,
            detail="That account has been deactivated",
        )
    if is_team_member(team_id, requester.id, session):
        # Added some other way since asking: the request has done its job.
        session.delete(request)
        session.commit()
        raise api_error(
            status_code=400,
            code=ErrorCode.already_member,
            detail="User is already a member",
        )
    # Made an account from outside after asking (#243): only ever a guest.
    outside.refuse_unless_guest(requester, payload.role)

    session.add(TeamMember(team_id=team_id, user_id=requester.id, role=payload.role))
    session.delete(request)
    session.commit()

    role = {
        TeamRole.admin: "an admin",
        TeamRole.member: "a member",
        TeamRole.guest: "a guest",
    }[payload.role]
    message = (
        requester.email,
        f"You are on {team.name} on {settings.app_name}",
        f"{admin.full_name} approved your request to join {team.name} · "
        f"{team.key}. You are on it as {role}.\n\n{_link('/' + team.key)}\n",
    )
    member = next(
        m for m in list_members_of(session, team_id) if m.user.id == requester.id
    )
    return member, message


def decline(
    session: Session, admin: User, team_id: int, request_id: int
) -> Optional[Message]:
    """Decline a request, and tell the person who asked."""
    from web import settings

    team = get_team_or_404(team_id, session)
    require_team_admin(team_id, admin, session)
    request = _live_request(session, team_id, request_id)
    requester = session.get(User, request.requester_id)
    session.delete(request)
    session.commit()
    return (
        requester.email,
        f"Your request to join {team.name} on {settings.app_name}",
        f"{admin.full_name} declined your request to join {team.name} · "
        f"{team.key}.\n",
    )
