from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack import estimates as estimates_service
from lib_softtrack import issues as issues_service
from lib_softtrack import links as links_service
from lib_softtrack.models.estimates import EstimateSummary
from lib_softtrack.models.issues import IssueCreate, IssueRead, IssueUpdate
from lib_softtrack.models.links import IssueLinkCreate, IssueLinkRead, IssueLinks
from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT, Page
from lib_softtrack.storage import Storage, get_storage
from lib_softtrack.tables import IssuePriority, User
from web import get_session

router = APIRouter(tags=["issues"])


@router.post("/teams/{team_id}/issues", response_model=IssueRead)
def create_issue(
    team_id: int,
    payload: IssueCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return issues_service.create_issue(session, current_user, team_id, payload)


@router.get("/teams/{team_id}/issues", response_model=Page[IssueRead])
def list_issues(
    team_id: int,
    project_id: Optional[int] = None,
    status_id: Optional[int] = Query(None, description="Only issues in this status."),
    priority: Optional[IssuePriority] = None,
    assignee_id: Optional[int] = None,
    unassigned: bool = Query(
        False, description="Only issues with nobody assigned. Overrides assignee_id."
    ),
    label_id: Optional[int] = Query(None, description="Only issues with this label."),
    parent_id: Optional[int] = Query(
        None, description="Only sub-issues of this issue."
    ),
    cycle_id: Optional[int] = Query(None, description="Only issues in this cycle."),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return issues_service.list_issues(
        session,
        current_user,
        team_id,
        project_id=project_id,
        status_id=status_id,
        priority=priority,
        assignee_id=assignee_id,
        unassigned=unassigned,
        label_id=label_id,
        parent_id=parent_id,
        cycle_id=cycle_id,
        limit=limit,
        offset=offset,
    )


@router.get("/teams/{team_id}/estimates", response_model=EstimateSummary)
def get_estimate_summary(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Story-point rollups by column and by assignee for the whole team.

    Separate from the issue list because the list is paginated: summing a page
    would silently report the total of whatever the client happened to load.
    """
    return estimates_service.estimate_summary(session, current_user, team_id)


@router.get("/issues/{issue_id}", response_model=IssueRead)
def get_issue(
    issue_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return issues_service.get_issue(session, current_user, issue_id)


@router.patch("/issues/{issue_id}", response_model=IssueRead)
def update_issue(
    issue_id: int,
    payload: IssueUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return issues_service.update_issue(session, current_user, issue_id, payload)


@router.delete("/issues/{issue_id}", status_code=204)
def delete_issue(
    issue_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    current_user: User = Depends(get_current_user),
):
    """Delete an issue and everything that only existed because of it.

    Attachments go with it, bytes included -- see
    `lib_softtrack/issues.py`. Sub-issues do not: they are promoted to top
    level rather than destroyed.
    """
    issues_service.delete_issue(session, current_user, issue_id, storage)


@router.get("/issues/{issue_id}/links", response_model=IssueLinks)
def list_issue_links(
    issue_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Every relationship this issue has, grouped by how it reads from here.

    A `blocks` row appears under `blocks` for the source issue and under
    `blocked_by` for the target -- one stored row, two readings.
    """
    return links_service.list_links(session, current_user, issue_id)


@router.post("/issues/{issue_id}/links", response_model=IssueLinkRead)
def create_issue_link(
    issue_id: int,
    payload: IssueLinkCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return links_service.create_link(session, current_user, issue_id, payload)


@router.delete("/issues/{issue_id}/links/{link_id}", status_code=204)
def delete_issue_link(
    issue_id: int,
    link_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    links_service.delete_link(session, current_user, issue_id, link_id)
