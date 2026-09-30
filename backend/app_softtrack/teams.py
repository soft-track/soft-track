from typing import Optional

from fastapi import APIRouter, Depends, Query, Response
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_user
from lib_softtrack import teams as teams_service
from lib_softtrack.models.teams import (
    TeamCreate,
    TeamDirectoryEntry,
    TeamMemberAdd,
    TeamMemberRead,
    TeamMemberUpdate,
    TeamRead,
    TeamUpdate,
)
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(prefix="/teams", tags=["teams"])


@router.post("", response_model=TeamRead)
def create_team(
    payload: TeamCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return teams_service.create_team(session, current_user, payload)


@router.get("", response_model=list[TeamRead])
def list_my_teams(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return teams_service.list_teams_for_user(session, current_user)


# Before /{team_id}, which would otherwise read "directory" as a team id.
@router.get("/directory", response_model=list[TeamDirectoryEntry])
def team_directory(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Every team, with its size and admins: who to ask to be added (#318)."""
    return teams_service.team_directory(session)


@router.get("/{team_id}", response_model=TeamRead)
def get_team(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return teams_service.get_team(session, current_user, team_id)


@router.patch("/{team_id}", response_model=TeamRead, dependencies=[team_writer])
def update_team(
    team_id: int,
    payload: TeamUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return teams_service.update_team(session, current_user, team_id, payload)


@router.get("/{team_id}/members", response_model=list[TeamMemberRead])
def list_team_members(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return teams_service.list_team_members(session, current_user, team_id)


@router.post(
    "/{team_id}/members", response_model=TeamMemberRead, dependencies=[team_writer]
)
def add_team_member(
    team_id: int,
    payload: TeamMemberAdd,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return teams_service.add_team_member(session, current_user, team_id, payload)


@router.patch(
    "/{team_id}/members/{user_id}",
    response_model=TeamMemberRead,
    dependencies=[team_writer],
)
def update_team_member_role(
    team_id: int,
    user_id: int,
    payload: TeamMemberUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return teams_service.update_team_member_role(
        session, current_user, team_id, user_id, payload
    )


@router.delete("/{team_id}/members/{user_id}", status_code=204)
def remove_team_member(
    team_id: int,
    user_id: int,
    reassign_to: Optional[int] = Query(
        None,
        description="Who takes their open tickets on this team. Left out, the "
        "tickets are unassigned. Done and cancelled tickets keep their assignee.",
    ),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Remove a member, or -- when the ids match -- leave the team yourself."""
    teams_service.remove_team_member(
        session, current_user, team_id, user_id, reassign_to
    )
    return Response(status_code=204)
