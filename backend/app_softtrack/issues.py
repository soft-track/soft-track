from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack import issues as issues_service
from lib_softtrack.models.issues import IssueCreate, IssueRead, IssueUpdate
from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT, Page
from lib_softtrack.tables import IssuePriority, IssueStatus, User
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
    status: Optional[IssueStatus] = None,
    priority: Optional[IssuePriority] = None,
    assignee_id: Optional[int] = None,
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
        status=status,
        priority=priority,
        assignee_id=assignee_id,
        limit=limit,
        offset=offset,
    )


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
    current_user: User = Depends(get_current_user),
):
    issues_service.delete_issue(session, current_user, issue_id)
