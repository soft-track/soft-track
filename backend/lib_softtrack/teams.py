"""Team services, including the membership guards the other domains rely on."""

from fastapi import HTTPException
from sqlmodel import Session, func, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.teams import (
    TeamCreate,
    TeamMemberAdd,
    TeamMemberRead,
    TeamMemberUpdate,
    TeamUpdate,
)
from lib_softtrack.tables import Team, TeamMember, TeamRole, User


def get_team_or_404(team_id: int, session: Session) -> Team:
    team = session.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


def require_team_member(team_id: int, user: User, session: Session) -> TeamMember:
    """Every team-scoped endpoint funnels through here; it is the tenancy boundary."""
    membership = session.exec(
        select(TeamMember).where(
            TeamMember.team_id == team_id, TeamMember.user_id == user.id
        )
    ).first()
    if not membership:
        raise HTTPException(status_code=403, detail="Not a member of this team")
    return membership


def require_team_admin(team_id: int, user: User, session: Session) -> TeamMember:
    """The guard for anything that changes who is in a team, or what it is called.

    A separate step after `require_team_member` rather than a flag on it, so
    that reading a team and administering it are visibly different checks at
    every call site.
    """
    membership = require_team_member(team_id, user, session)
    if membership.role != TeamRole.admin:
        raise HTTPException(status_code=403, detail="Only team admins can do that")
    return membership


def _active_admin_count(session: Session, team_id: int) -> int:
    """How many admins of this team could actually sign in and use the power.

    Deactivated accounts are excluded on purpose: a team whose only other admin
    was deactivated last month is one "leave" away from having nobody who can
    add a member, and counting the dormant row would let that happen.
    """
    return session.exec(
        select(func.count())
        .select_from(TeamMember)
        .join(User, User.id == TeamMember.user_id)
        .where(
            TeamMember.team_id == team_id,
            TeamMember.role == TeamRole.admin,
            User.is_active == True,  # noqa: E712 -- SQL comparison, not a bool test
        )
    ).one()


def create_team(session: Session, current_user: User, payload: TeamCreate) -> Team:
    key = payload.key.upper()
    existing = session.exec(select(Team).where(Team.key == key)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Team key already in use")

    team = Team(name=payload.name, key=key, description=payload.description)
    session.add(team)
    session.commit()
    session.refresh(team)

    membership = TeamMember(
        team_id=team.id, user_id=current_user.id, role=TeamRole.admin
    )
    session.add(membership)

    # Imported here rather than at module scope: the status service imports
    # this module for its permission guards, and at module level that is a
    # cycle. A team without statuses would have nowhere to put its first
    # issue, so this is not optional setup.
    from lib_softtrack.statuses import create_default_statuses

    create_default_statuses(session, team.id)
    session.commit()

    return team


def list_teams_for_user(session: Session, current_user: User) -> list[Team]:
    statement = (
        select(Team)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(TeamMember.user_id == current_user.id)
    )
    return session.exec(statement).all()


def get_team(session: Session, current_user: User, team_id: int) -> Team:
    team = get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    return team


def update_team(
    session: Session, current_user: User, team_id: int, payload: TeamUpdate
) -> Team:
    team = get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)

    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="A team needs a name")
        team.name = name
    if payload.description is not None:
        team.description = payload.description.strip() or None

    session.add(team)
    session.commit()
    session.refresh(team)
    return team


def list_team_members(
    session: Session, current_user: User, team_id: int
) -> list[TeamMemberRead]:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    # One join rather than a session.get per row: a roster is read on every
    # board load, and the per-row version made it N+1 queries deep.
    rows = session.exec(
        select(TeamMember, User)
        .join(User, User.id == TeamMember.user_id)
        .where(TeamMember.team_id == team_id)
        # Admins first, then in the order people joined: the roster reads as
        # "who runs this team" before "who is on it".
        .order_by(TeamMember.role, TeamMember.joined_at)
    ).all()

    return [
        TeamMemberRead(
            user=UserPublic.model_validate(user),
            role=membership.role,
            joined_at=membership.joined_at,
        )
        for membership, user in rows
    ]


def add_team_member(
    session: Session, current_user: User, team_id: int, payload: TeamMemberAdd
) -> TeamMemberRead:
    from lib_identity.identity import find_user_by_email

    get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)

    user = find_user_by_email(session, payload.email)
    if not user:
        raise HTTPException(status_code=404, detail="No user with that email")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="That account has been deactivated")

    existing = session.exec(
        select(TeamMember).where(
            TeamMember.team_id == team_id, TeamMember.user_id == user.id
        )
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="User is already a member")

    membership = TeamMember(team_id=team_id, user_id=user.id, role=payload.role)
    session.add(membership)
    session.commit()
    session.refresh(membership)

    return TeamMemberRead(
        user=UserPublic.model_validate(user),
        role=membership.role,
        joined_at=membership.joined_at,
    )


def _membership_or_404(session: Session, team_id: int, user_id: int) -> TeamMember:
    membership = session.exec(
        select(TeamMember).where(
            TeamMember.team_id == team_id, TeamMember.user_id == user_id
        )
    ).first()
    if not membership:
        raise HTTPException(status_code=404, detail="Not a member of this team")
    return membership


def update_team_member_role(
    session: Session,
    current_user: User,
    team_id: int,
    member_user_id: int,
    payload: TeamMemberUpdate,
) -> TeamMemberRead:
    get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)

    membership = _membership_or_404(session, team_id, member_user_id)

    demoting_an_admin = (
        membership.role == TeamRole.admin and payload.role != TeamRole.admin
    )
    if demoting_an_admin and _active_admin_count(session, team_id) <= 1:
        raise HTTPException(status_code=409, detail="A team needs at least one admin")

    membership.role = payload.role
    session.add(membership)
    session.commit()
    session.refresh(membership)

    user = session.get(User, member_user_id)
    return TeamMemberRead(
        user=UserPublic.model_validate(user),
        role=membership.role,
        joined_at=membership.joined_at,
    )


def remove_team_member(
    session: Session, current_user: User, team_id: int, member_user_id: int
) -> None:
    """Remove someone from a team, or leave it yourself.

    One function for both because they are the same row and the same guards --
    only who is allowed to ask differs. Issues stay assigned to whoever left,
    the way Jira leaves them: unassigning them would quietly rewrite history
    and lose the one piece of information anybody still wants.
    """
    get_team_or_404(team_id, session)

    leaving = member_user_id == current_user.id
    if leaving:
        require_team_member(team_id, current_user, session)
    else:
        require_team_admin(team_id, current_user, session)

    membership = _membership_or_404(session, team_id, member_user_id)

    if membership.role == TeamRole.admin and _active_admin_count(session, team_id) <= 1:
        raise HTTPException(status_code=409, detail="A team needs at least one admin")

    session.delete(membership)
    session.commit()
