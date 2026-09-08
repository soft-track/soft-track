from fastapi import APIRouter, Depends
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack import integrations as integrations_service
from lib_softtrack.models.integrations import (
    CodeLinks,
    RepositoryCreate,
    RepositoryRead,
)
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["integrations"])


@router.get("/teams/{team_id}/repositories", response_model=list[RepositoryRead])
def list_repositories(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """The team's connected repositories.

    Admins only, unlike the automation rules next to it: this response carries
    the webhook secrets, and a secret every member can read is one that has to
    be rotated whenever anybody leaves the team.
    """
    return integrations_service.list_repositories(session, current_user, team_id)


@router.post("/teams/{team_id}/repositories", response_model=RepositoryRead)
def create_repository(
    team_id: int,
    payload: RepositoryCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Connect a repository. Returns the webhook URL and secret to paste into
    the provider; nothing happens until the first delivery arrives."""
    return integrations_service.create_repository(
        session, current_user, team_id, payload
    )


@router.post("/repositories/{repository_id}/rotate", response_model=RepositoryRead)
def rotate_secret(
    repository_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Issue a new secret *and* a new webhook URL -- see the service for why
    both move together."""
    return integrations_service.rotate_secret(session, current_user, repository_id)


@router.delete("/repositories/{repository_id}", status_code=204)
def delete_repository(
    repository_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Disconnect a repository. Its links come off the issues with it."""
    integrations_service.delete_repository(session, current_user, repository_id)


@router.get("/issues/{issue_id}/code-links", response_model=CodeLinks)
def list_code_links(
    issue_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """The branches, commits and pull requests that name this issue.

    Any member, unlike the repository list above: this carries no secrets, and
    "where is the code for this" is the question the whole feature exists to
    answer.
    """
    return integrations_service.list_code_links(session, current_user, issue_id)
