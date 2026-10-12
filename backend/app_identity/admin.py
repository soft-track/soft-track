from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Response
from sqlmodel import Session

from lib_identity import accounts
from lib_identity import admin as admin_service
from lib_identity import admin_teams
from lib_identity.admin import require_site_admin
from lib_identity.models.admin import (
    AdminPasswordReset,
    AdminRole,
    AdminTeamAppoint,
    AdminTeamFilter,
    AdminTeamRead,
    AdminUserCreate,
    AdminUserCreated,
    AdminUserRead,
    AdminUserUpdate,
    WelcomeLinkCreate,
    WelcomeLinkCreated,
)
from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT, Page
from lib_softtrack.models.teams import TeamMemberRead
from lib_softtrack.tables import User
from lib_utils.mailer import get_mailer
from web import get_session

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=Page[AdminUserRead])
def list_users(
    q: Optional[str] = Query(
        default=None, description="Search name, email or username"
    ),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    reports_to_deactivated: bool = Query(
        default=False,
        description="Only active people whose manager has been deactivated",
    ),
    role: Optional[AdminRole] = Query(
        default=None, description="Only site admins, or only finance admins"
    ),
    session: Session = Depends(get_session),
    _: User = Depends(require_site_admin),
):
    return admin_service.list_users(
        session,
        q=q,
        limit=limit,
        offset=offset,
        reports_to_deactivated=reports_to_deactivated,
        role=role,
    )


@router.post("/users", response_model=AdminUserCreated, status_code=201)
def create_user(
    payload: AdminUserCreate,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
    actor: User = Depends(require_site_admin),
):
    """Create an account for somebody, without a password (#303).

    The response carries the link its owner chooses a password from -- the
    only time it is shown. With `send_email` it is emailed to them as well,
    after the response. Not counted by the registration rate limit, and open
    whether or not registration is.
    """
    created, message = accounts.create_account(session, actor, payload)
    if message is not None:
        background.add_task(get_mailer().send, *message)
    return created


@router.post("/users/{user_id}/welcome-link", response_model=WelcomeLinkCreated)
def new_welcome_link(
    user_id: int,
    payload: WelcomeLinkCreate,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
    actor: User = Depends(require_site_admin),
):
    """A new link to choose a password, for an account not yet activated.
    The link before it stops working."""
    created, message = accounts.new_link(session, actor, user_id, payload.send_email)
    if message is not None:
        background.add_task(get_mailer().send, *message)
    return created


@router.patch("/users/{user_id}", response_model=AdminUserRead)
def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_site_admin),
):
    return admin_service.update_user(session, actor, user_id, payload)


@router.post("/users/{user_id}/reset-password", status_code=204)
def reset_password(
    user_id: int,
    payload: AdminPasswordReset,
    session: Session = Depends(get_session),
    actor: User = Depends(require_site_admin),
):
    admin_service.reset_password(session, actor, user_id, payload.new_password)
    return Response(status_code=204)


# --- Every team on the instance (#307) ---------------------------------------


@router.get("/teams", response_model=Page[AdminTeamRead])
def list_teams(
    q: Optional[str] = Query(default=None, description="Search name or key"),
    filter: Optional[AdminTeamFilter] = Query(
        default=None,
        description="Only quiet teams, teams with one admin, or archived ones",
    ),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
    _: User = Depends(require_site_admin),
):
    """Every team, with its size, dates and admins. Never its tickets."""
    return admin_teams.list_teams(
        session, q=q, which=filter, limit=limit, offset=offset
    )


@router.get("/teams/{team_id}/members", response_model=list[TeamMemberRead])
def list_team_members(
    team_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(require_site_admin),
):
    """Who is on the team and as what, for appointing its next admin."""
    return admin_teams.list_members(session, team_id)


@router.post("/teams/{team_id}/admins", response_model=AdminTeamRead)
def appoint_team_admin(
    team_id: int,
    payload: AdminTeamAppoint,
    session: Session = Depends(get_session),
    actor: User = Depends(require_site_admin),
):
    return admin_teams.appoint_admin(session, actor, team_id, payload.user_id)


@router.post("/teams/{team_id}/archive", response_model=AdminTeamRead)
def archive_team(
    team_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_site_admin),
):
    return admin_teams.set_archived(session, actor, team_id, True)


@router.post("/teams/{team_id}/unarchive", response_model=AdminTeamRead)
def unarchive_team(
    team_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_site_admin),
):
    return admin_teams.set_archived(session, actor, team_id, False)


@router.delete("/teams/{team_id}", status_code=204)
def delete_team(
    team_id: int,
    session: Session = Depends(get_session),
    actor: User = Depends(require_site_admin),
):
    """Only a team with no tickets, the trash included."""
    admin_teams.delete_team(session, actor, team_id)
    return Response(status_code=204)
