"""Team services, including the membership guards the other domains rely on."""

from fastapi import HTTPException
from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.teams import TeamCreate, TeamMemberAdd, TeamMemberRead
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


def list_team_members(
    session: Session, current_user: User, team_id: int
) -> list[TeamMemberRead]:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    memberships = session.exec(
        select(TeamMember).where(TeamMember.team_id == team_id)
    ).all()

    result = []
    for membership in memberships:
        user = session.get(User, membership.user_id)
        result.append(
            TeamMemberRead(user=UserPublic.model_validate(user), role=membership.role)
        )
    return result


def add_team_member(
    session: Session, current_user: User, team_id: int, payload: TeamMemberAdd
) -> TeamMemberRead:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    user = session.exec(select(User).where(User.email == payload.email)).first()
    if not user:
        raise HTTPException(status_code=404, detail="No user with that email")

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

    return TeamMemberRead(user=UserPublic.model_validate(user), role=membership.role)
