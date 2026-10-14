from typing import Optional

from fastapi import APIRouter, Body, Depends
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_user
from lib_softtrack import releases as releases_service
from lib_softtrack.models.releases import (
    ReleaseCreate,
    ReleaseNotes,
    ReleaseRead,
    ReleaseRequest,
    ReleaseResult,
    ReleaseUpdate,
)
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["releases"])


@router.get("/teams/{team_id}/releases", response_model=list[ReleaseRead])
def list_releases(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """The versions a team ships (#272): planned, then released, then
    archived, newest first in each."""
    return releases_service.list_releases(session, current_user, team_id)


@router.post(
    "/teams/{team_id}/releases", response_model=ReleaseRead, dependencies=[team_writer]
)
def create_release(
    team_id: int,
    payload: ReleaseCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return releases_service.create_release(session, current_user, team_id, payload)


@router.get("/releases/{release_id}", response_model=ReleaseRead)
def get_release(
    release_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return releases_service.get_release(session, current_user, release_id)


@router.patch(
    "/releases/{release_id}", response_model=ReleaseRead, dependencies=[team_writer]
)
def update_release(
    release_id: int,
    payload: ReleaseUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return releases_service.update_release(session, current_user, release_id, payload)


@router.post(
    "/releases/{release_id}/release",
    response_model=ReleaseResult,
    dependencies=[team_writer],
)
def release_release(
    release_id: int,
    payload: Optional[ReleaseRequest] = Body(None),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Release it: set the day it shipped, and move the tickets that are not
    done to another planned release or leave them without one."""
    return releases_service.release_release(
        session, current_user, release_id, payload or ReleaseRequest()
    )


@router.get("/releases/{release_id}/notes", response_model=ReleaseNotes)
def release_notes(
    release_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """A draft of the release notes in markdown, from the done tickets."""
    return releases_service.release_notes(session, current_user, release_id)


@router.delete("/releases/{release_id}", status_code=204, dependencies=[team_writer])
def delete_release(
    release_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    releases_service.delete_release(session, current_user, release_id)
