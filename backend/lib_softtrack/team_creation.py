"""Who may create teams, and asking for one (#306).

Creating a team asked only that somebody was signed in. A team takes a key,
and a key is never given back, so on an instance with open registration a
stranger could take ENG -- and on the test instance a client's guest account
created a team. An instance setting now says who may: anyone (the default,
and what it always was), the site admins only, or named people. It is kept
in `InstanceSettings`, and TEAM_CREATION in the environment wins over it.

An account from outside the organisation (#243) never may, whatever the
setting. Anybody else who may not can ask for a team, with a name, a key and
a reason; the site admins are told, and approving creates the team with the
person who asked as its admin.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Session, func, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.team_creation import (
    TeamCreationAccess,
    TeamCreationSettings,
    TeamCreationUpdate,
    TeamRequestCreate,
    TeamRequestDecline,
    TeamRequestRead,
)
from lib_softtrack.models.teams import TeamCreate
from lib_softtrack.tables import (
    InstanceSettings,
    Team,
    TeamCreationPolicy,
    TeamCreator,
    TeamRequest,
    TeamRequestState,
    User,
)
from lib_utils.errors import ErrorCode, api_error

#: A message to send after the response: recipient, subject, body.
Message = tuple[str, str, str]

_SETTINGS_ID = 1


def _environment_policy() -> Optional[TeamCreationPolicy]:
    from web import settings

    if settings.team_creation is None:
        return None
    return TeamCreationPolicy(settings.team_creation)


def _stored(session: Session) -> Optional[InstanceSettings]:
    return session.get(InstanceSettings, _SETTINGS_ID)


def current_policy(session: Session) -> TeamCreationPolicy:
    """The policy in force: the environment's, else the app's, else anyone."""
    from_environment = _environment_policy()
    if from_environment is not None:
        return from_environment
    stored = _stored(session)
    return stored.team_creation if stored else TeamCreationPolicy.anyone


def may_create_team(session: Session, user: User) -> bool:
    if user.is_external:
        return False
    policy = current_policy(session)
    if policy == TeamCreationPolicy.anyone or user.is_site_admin:
        return True
    if policy == TeamCreationPolicy.named_people:
        return session.get(TeamCreator, user.id) is not None
    return False


def require_may_create_team(session: Session, user: User) -> None:
    """The guard on `POST /teams`. External accounts are refused before
    this, by `get_current_insider`."""
    if not may_create_team(session, user):
        raise api_error(
            status_code=403,
            code=ErrorCode.team_creation_restricted,
            detail="Teams on this instance are created by site admins or named "
            "people; ask for one instead",
        )


def _active_site_admins(session: Session) -> list[User]:
    return list(
        session.exec(
            select(User)
            .where(
                User.is_site_admin == True,  # noqa: E712 -- SQL comparison
                User.is_active == True,  # noqa: E712
            )
            .order_by(func.lower(User.full_name))
        ).all()
    )


def _request_read(request: TeamRequest) -> TeamRequestRead:
    return TeamRequestRead(
        id=request.id,
        requester=UserPublic.model_validate(request.requester),
        name=request.name,
        key=request.key,
        reason=request.reason,
        state=request.state,
        created_at=request.created_at,
        decided_at=request.decided_at,
        decline_reason=request.decline_reason,
    )


def _pending(session: Session, requester_id: Optional[int] = None):
    statement = select(TeamRequest).where(TeamRequest.state == TeamRequestState.pending)
    if requester_id is not None:
        statement = statement.where(TeamRequest.requester_id == requester_id)
    return session.exec(statement.order_by(TeamRequest.created_at)).all()


def access(session: Session, user: User) -> TeamCreationAccess:
    may = may_create_team(session, user)
    return TeamCreationAccess(
        may_create=may,
        policy=current_policy(session),
        site_admins=(
            []
            if may or user.is_external
            else [UserPublic.model_validate(u) for u in _active_site_admins(session)]
        ),
        pending_requests=(
            []
            if user.is_external
            else [_request_read(r) for r in _pending(session, user.id)]
        ),
    )


# --- asking for a team -------------------------------------------------------


def _require_key_free(session: Session, key: str) -> None:
    taken = session.exec(select(Team.id).where(Team.key == key)).first()
    asked = session.exec(
        select(TeamRequest.id).where(
            TeamRequest.key == key, TeamRequest.state == TeamRequestState.pending
        )
    ).first()
    if taken is not None or asked is not None:
        raise api_error(
            status_code=400,
            code=ErrorCode.team_key_taken,
            detail="Team key already in use",
        )


def _link(path: str) -> str:
    from web import settings

    return f"{settings.app_base_url.rstrip('/')}{path}"


def request_team(
    session: Session, user: User, payload: TeamRequestCreate
) -> tuple[TeamRequestRead, list[Message]]:
    """Ask for a team. Returns the request and a message for each site admin."""
    from web import settings

    name = payload.name.strip()
    reason = payload.reason.strip()
    if not name or not reason:
        raise api_error(
            status_code=400,
            code=ErrorCode.name_required,
            detail="A team needs a name, and a request a reason",
        )
    key = payload.key.upper()
    _require_key_free(session, key)

    request = TeamRequest(requester_id=user.id, name=name, key=key, reason=reason)
    session.add(request)
    session.commit()
    session.refresh(request)

    subject = f"{user.full_name} asks for a team on {settings.app_name}"
    body = (
        f"{user.full_name} ({user.email}) asks for a team:\n\n"
        f"  {name} · {key}\n\n"
        f"What it is for: {reason}\n\n"
        f"Approve or decline it here:\n{_link('/settings/admin/settings')}\n\n"
        "Approving creates the team, with them as its admin.\n"
    )
    messages = [
        (admin.email, subject, body)
        for admin in _active_site_admins(session)
        if admin.id != user.id
    ]
    return _request_read(request), messages


# --- the site admin's side ---------------------------------------------------


def _settings_read(session: Session) -> TeamCreationSettings:
    named = session.exec(
        select(User)
        .join(TeamCreator, TeamCreator.user_id == User.id)
        .order_by(func.lower(User.full_name))
    ).all()
    return TeamCreationSettings(
        policy=current_policy(session),
        from_environment=_environment_policy() is not None,
        named_people=[UserPublic.model_validate(u) for u in named],
        requests=[_request_read(r) for r in _pending(session)],
    )


def get_settings(session: Session) -> TeamCreationSettings:
    return _settings_read(session)


def update_settings(
    session: Session, actor: User, payload: TeamCreationUpdate
) -> TeamCreationSettings:
    environment = _environment_policy()
    if environment is not None and payload.policy != environment:
        raise api_error(
            status_code=409,
            code=ErrorCode.team_creation_from_environment,
            detail="Who may create teams is set as TEAM_CREATION in the "
            "environment, which wins",
        )

    wanted = set(payload.named_people_ids)
    people = (
        session.exec(select(User).where(User.id.in_(wanted))).all() if wanted else []
    )
    if len(people) != len(wanted):
        raise api_error(
            status_code=404, code=ErrorCode.user_not_found, detail="User not found"
        )
    if any(person.is_external for person in people):
        raise api_error(
            status_code=400,
            code=ErrorCode.external_account,
            detail="An account from outside the organisation never creates a team",
        )

    stored = _stored(session)
    if stored is None:
        stored = InstanceSettings(id=_SETTINGS_ID)
    if environment is None:
        stored.team_creation = payload.policy
    stored.updated_at = datetime.now(timezone.utc)
    session.add(stored)

    existing = {row.user_id: row for row in session.exec(select(TeamCreator)).all()}
    for user_id, row in existing.items():
        if user_id not in wanted:
            session.delete(row)
    for user_id in wanted - existing.keys():
        session.add(TeamCreator(user_id=user_id, added_by_id=actor.id))
    session.commit()
    return _settings_read(session)


def _pending_or_error(session: Session, request_id: int) -> TeamRequest:
    request = session.get(TeamRequest, request_id)
    if request is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.team_request_not_found,
            detail="Request not found",
        )
    if request.state != TeamRequestState.pending:
        raise api_error(
            status_code=409,
            code=ErrorCode.team_request_decided,
            detail="This request has already been decided",
        )
    return request


def approve_request(
    session: Session, actor: User, request_id: int
) -> tuple[Team, Optional[Message]]:
    """Create the team, with the person who asked as its admin."""
    from lib_softtrack.teams import create_team
    from web import settings

    request = _pending_or_error(session, request_id)
    requester = session.get(User, request.requester_id)
    if requester.is_external:
        # Made external after asking: such an account is only ever a guest.
        raise api_error(
            status_code=400,
            code=ErrorCode.external_account_is_guest,
            detail="An account from outside the organisation cannot run a team",
        )
    team = create_team(
        session, requester, TeamCreate(name=request.name, key=request.key)
    )
    request.state = TeamRequestState.approved
    request.decided_by_id = actor.id
    request.decided_at = datetime.now(timezone.utc)
    request.team_id = team.id
    session.add(request)
    session.commit()
    session.refresh(team)

    message = (
        requester.email,
        f"Your team {team.name} is ready on {settings.app_name}",
        f"{actor.full_name} approved your request for {team.name} · {team.key}. "
        f"You are its admin.\n\n{_link('/' + team.key)}\n",
    )
    return team, message


def decline_request(
    session: Session, actor: User, request_id: int, payload: TeamRequestDecline
) -> tuple[TeamRequestRead, Optional[Message]]:
    from web import settings

    request = _pending_or_error(session, request_id)
    reason = (payload.reason or "").strip() or None
    request.state = TeamRequestState.declined
    request.decided_by_id = actor.id
    request.decided_at = datetime.now(timezone.utc)
    request.decline_reason = reason
    session.add(request)
    session.commit()
    session.refresh(request)

    requester = session.get(User, request.requester_id)
    body = (
        f"{actor.full_name} declined your request for {request.name} · {request.key}."
    )
    if reason:
        body += f"\n\n{reason}"
    message = (
        requester.email,
        f"Your request for {request.name} on {settings.app_name}",
        body + "\n",
    )
    return _request_read(request), message
