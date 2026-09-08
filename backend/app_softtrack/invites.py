from fastapi import APIRouter, Depends, Response
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack import invites as invites_service
from lib_softtrack.models.invites import InviteCreate, InvitePreview, InviteRead
from lib_softtrack.models.teams import TeamRead
from lib_softtrack.tables import User
from web import get_session

# No prefix: the team-scoped routes hang off /teams and the two the invitee
# uses hang off /invites, and splitting them into two routers would put the
# same service behind two tags in the docs.
router = APIRouter(tags=["invites"])


@router.post("/teams/{team_id}/invites", response_model=InviteRead)
def create_invite(
    team_id: int,
    payload: InviteCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return invites_service.create_invite(session, current_user, team_id, payload)


@router.get("/teams/{team_id}/invites", response_model=list[InviteRead])
def list_invites(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return invites_service.list_invites(session, current_user, team_id)


@router.delete("/teams/{team_id}/invites/{invite_id}", status_code=204)
def revoke_invite(
    team_id: int,
    invite_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    invites_service.revoke_invite(session, current_user, team_id, invite_id)
    return Response(status_code=204)


@router.get("/invites/{token}", response_model=InvitePreview)
def preview_invite(token: str, session: Session = Depends(get_session)):
    """Unauthenticated on purpose: this is what the link shows a stranger."""
    return invites_service.get_invite_preview(session, token)


@router.post("/invites/{token}/accept", response_model=TeamRead)
def accept_invite(
    token: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return invites_service.accept_invite(session, current_user, token)


@router.post("/invites/{token}/decline", status_code=204)
def decline_invite(
    token: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    invites_service.decline_invite(session, current_user, token)
    return Response(status_code=204)
