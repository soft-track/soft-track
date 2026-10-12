from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Response
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_insider, get_current_user
from lib_softtrack import joining, team_creation
from lib_softtrack import teams as teams_service
from lib_softtrack.models.team_creation import (
    TeamCreationAccess,
    TeamRequestCreate,
    TeamRequestRead,
)
from lib_softtrack.models.teams import (
    JoinRequestApprove,
    JoinRequestCreate,
    JoinRequestRead,
    MyJoinRequest,
    TeamCreate,
    TeamDirectory,
    TeamMemberAdd,
    TeamMemberRead,
    TeamMemberUpdate,
    TeamRead,
    TeamUpdate,
)
from lib_softtrack.tables import User
from lib_utils.mailer import get_mailer
from web import get_session

router = APIRouter(prefix="/teams", tags=["teams"])


@router.post("", response_model=TeamRead)
def create_team(
    payload: TeamCreate,
    session: Session = Depends(get_session),
    # Not somebody from outside the organisation (#317): a client of the
    # instance does not run a team on it.
    current_user: User = Depends(get_current_insider),
):
    # And only whoever the instance lets (#306).
    team_creation.require_may_create_team(session, current_user)
    return teams_service.create_team(session, current_user, payload)


@router.get("", response_model=list[TeamRead])
def list_my_teams(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return teams_service.list_teams_for_user(session, current_user)


# Before /{team_id}, which would otherwise read "directory" as a team id.
@router.get("/directory", response_model=TeamDirectory)
def team_directory(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """The teams there are, with their size and admins (#318), and where you
    stand with each: on it, asked to join it, or neither (#259)."""
    return teams_service.team_directory(session, current_user)


@router.delete("/join-requests/{join_request_id}", status_code=204)
def withdraw_join_request(
    join_request_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """Withdraw your own request to join a team (#259)."""
    joining.withdraw(session, current_user, join_request_id)
    return Response(status_code=204)


@router.get("/creation", response_model=TeamCreationAccess)
def team_creation_access(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Whether you may create a team (#306), and if not, who to ask."""
    return team_creation.access(session, current_user)


@router.post("/requests", response_model=TeamRequestRead)
def request_team(
    payload: TeamRequestCreate,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """Ask for a team (#306). The site admins are emailed, when this instance
    sends mail, and find it under Administration -> Settings."""
    request, messages = team_creation.request_team(session, current_user, payload)
    mailer = get_mailer()
    for message in messages:
        background.add_task(mailer.send, *message)
    return request


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


# --- finding a team and asking to join it (#259) ------------------------------


@router.post("/{team_id}/join", response_model=TeamRead)
def join_open_team(
    team_id: int,
    session: Session = Depends(get_session),
    # Not somebody from outside the organisation (#317), who is invited.
    current_user: User = Depends(get_current_insider),
):
    """Join a team that is open to join, as a member, without asking."""
    return joining.join_open_team(session, current_user, team_id)


@router.post("/{team_id}/join-requests", response_model=MyJoinRequest)
def ask_to_join(
    team_id: int,
    payload: JoinRequestCreate,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """Ask to join a team, with an optional note. Its admins are emailed,
    when this instance sends mail, and find it under Settings -> Members."""
    request, messages = joining.ask_to_join(session, current_user, team_id, payload)
    mailer = get_mailer()
    for message in messages:
        background.add_task(mailer.send, *message)
    return request


@router.get("/{team_id}/join-requests", response_model=list[JoinRequestRead])
def list_join_requests(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """The requests to join waiting on the team, oldest first. Admins only."""
    return joining.list_requests(session, current_user, team_id)


@router.post(
    "/{team_id}/join-requests/{join_request_id}/approve",
    response_model=TeamMemberRead,
    dependencies=[team_writer],
)
def approve_join_request(
    team_id: int,
    join_request_id: int,
    payload: JoinRequestApprove,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Put the person on the team with the role chosen. They are emailed."""
    member, message = joining.approve(
        session, current_user, team_id, join_request_id, payload
    )
    if message is not None:
        background.add_task(get_mailer().send, *message)
    return member


@router.post(
    "/{team_id}/join-requests/{join_request_id}/decline",
    status_code=204,
    dependencies=[team_writer],
)
def decline_join_request(
    team_id: int,
    join_request_id: int,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    message = joining.decline(session, current_user, team_id, join_request_id)
    if message is not None:
        background.add_task(get_mailer().send, *message)
    return Response(status_code=204)
