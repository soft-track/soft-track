from fastapi import APIRouter, Depends, Response
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_user
from lib_softtrack import worklogs as worklogs_service
from lib_softtrack.models.worklogs import (
    IssueTime,
    WorklogCreate,
    WorklogRead,
    WorklogUpdate,
)
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["worklogs"])


@router.get("/issues/{issue_id}/worklogs", response_model=IssueTime)
def issue_time(
    issue_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Time spent on the issue: the total, who spent it, and every entry."""
    return worklogs_service.issue_time(session, current_user, issue_id)


@router.post(
    "/issues/{issue_id}/worklogs",
    response_model=WorklogRead,
    dependencies=[team_writer],
)
def log_time(
    issue_id: int,
    payload: WorklogCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Log time you spent on the issue, on one day."""
    return worklogs_service.log_time(session, current_user, issue_id, payload)


@router.patch(
    "/worklogs/{worklog_id}", response_model=WorklogRead, dependencies=[team_writer]
)
def update_worklog(
    worklog_id: int,
    payload: WorklogUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Change one of your own entries."""
    return worklogs_service.update_worklog(session, current_user, worklog_id, payload)


@router.delete("/worklogs/{worklog_id}", status_code=204, dependencies=[team_writer])
def delete_worklog(
    worklog_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Delete one of your own entries."""
    worklogs_service.delete_worklog(session, current_user, worklog_id)
    return Response(status_code=204)
