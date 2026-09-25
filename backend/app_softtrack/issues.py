from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_user
from lib_softtrack import estimates as estimates_service
from lib_softtrack import history as history_service
from lib_softtrack import issues as issues_service
from lib_softtrack import links as links_service
from lib_softtrack import transfers as transfers_service
from lib_softtrack.models.estimates import EstimateSummary
from lib_softtrack.models.history import IssueEventRead
from lib_softtrack.models.issues import (
    IssueBulkDelete,
    IssueBulkUpdate,
    IssueCreate,
    IssueMove,
    IssueRead,
    IssueUpdate,
)
from lib_softtrack.models.links import IssueLinkCreate, IssueLinkRead, IssueLinks
from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT, Page
from lib_softtrack.storage import Storage, get_storage
from lib_softtrack.models.transfers import (
    IssueTransfer,
    TransferPlan,
    TransferResult,
)
from lib_softtrack.tables import (
    DueFilter,
    IssuePriority,
    IssueSort,
    IssueType,
    SortDirection,
    User,
)
from web import get_session

router = APIRouter(tags=["issues"])


@router.post(
    "/teams/{team_id}/issues", response_model=IssueRead, dependencies=[team_writer]
)
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
    due: Optional[DueFilter] = Query(
        None, description="Overdue, due this week, or with no due date."
    ),
    today: Optional[date] = Query(
        None,
        description=(
            "The caller's own date, which `due` is measured from. Defaults to "
            "today in UTC; a client should send its local date, so that "
            "'this week' is its week."
        ),
    ),
    due_from: Optional[date] = Query(
        None, description="Only issues due on or after this day."
    ),
    due_to: Optional[date] = Query(
        None, description="Only issues due on or before this day."
    ),
    type: Optional[IssueType] = Query(None, description="Only issues of this type."),
    sort: IssueSort = Query(IssueSort.created, description="What to order by."),
    direction: SortDirection = Query(
        SortDirection.desc,
        description="desc is newest, most urgent, largest, or Z first.",
    ),
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
        due=due,
        today=today,
        due_from=due_from,
        due_to=due_to,
        type=type,
        sort=sort,
        direction=direction,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/teams/{team_id}/issues/bulk-update",
    response_model=list[IssueRead],
    dependencies=[team_writer],
)
def bulk_update_issues(
    team_id: int,
    payload: IssueBulkUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Apply one set of changes to up to 200 of the team's issues.

    Transactional: every issue changes or none does. Returns the issues as the
    batch left them, in the order they were asked for.
    """
    return issues_service.bulk_update_issues(session, current_user, team_id, payload)


@router.post(
    "/teams/{team_id}/issues/bulk-delete", status_code=204, dependencies=[team_writer]
)
def bulk_delete_issues(
    team_id: int,
    payload: IssueBulkDelete,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    current_user: User = Depends(get_current_user),
):
    """Delete up to 200 of the team's issues, all of them or none.

    A POST rather than a DELETE with a body, which too many clients and
    proxies drop. Each issue goes the way a single delete takes it --
    attachments with it, sub-issues promoted.
    """
    issues_service.bulk_delete_issues(session, current_user, team_id, payload, storage)


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


@router.get("/teams/{team_id}/issues/by-number/{number}", response_model=IssueRead)
def get_issue_by_number(
    team_id: int,
    number: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return issues_service.get_issue_by_number(session, current_user, team_id, number)


@router.post(
    "/issues/{issue_id}/move", response_model=IssueRead, dependencies=[team_writer]
)
def move_issue(
    issue_id: int,
    payload: IssueMove,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Place a card between two others on the board, optionally in another
    column. Its neighbours are named, never its new position's key -- the
    server works that out, so a client never has to."""
    return issues_service.move_issue(session, current_user, issue_id, payload)


@router.get("/issues/{issue_id}/events", response_model=list[IssueEventRead])
def list_issue_events(
    issue_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """What has happened to an issue: status, priority, assignee, estimate,
    cycle and project changes, oldest first, with who made each one.

    The latest 100 changes. The values an issue was created with are its
    starting point rather than changes, and are left out.
    """
    return history_service.issue_events(session, current_user, issue_id)


@router.get("/issues/{issue_id}", response_model=IssueRead)
def get_issue(
    issue_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return issues_service.get_issue(session, current_user, issue_id)


@router.patch(
    "/issues/{issue_id}", response_model=IssueRead, dependencies=[team_writer]
)
def update_issue(
    issue_id: int,
    payload: IssueUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return issues_service.update_issue(session, current_user, issue_id, payload)


@router.delete("/issues/{issue_id}", status_code=204, dependencies=[team_writer])
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


@router.post(
    "/issues/{issue_id}/links", response_model=IssueLinkRead, dependencies=[team_writer]
)
def create_issue_link(
    issue_id: int,
    payload: IssueLinkCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return links_service.create_link(session, current_user, issue_id, payload)


@router.delete(
    "/issues/{issue_id}/links/{link_id}", status_code=204, dependencies=[team_writer]
)
def delete_issue_link(
    issue_id: int,
    link_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    links_service.delete_link(session, current_user, issue_id, link_id)


@router.get("/issues/{issue_id}/transfer", response_model=TransferPlan)
def preview_transfer(
    issue_id: int,
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """What moving the issue to `team_id` would change, without changing it."""
    return transfers_service.preview_transfer(session, current_user, issue_id, team_id)


# `transfer` rather than `move`: /issues/{id}/move already exists, and is the
# board's drag -- a column and a place in it, on the same team.
@router.post(
    "/issues/{issue_id}/transfer",
    response_model=TransferResult,
    dependencies=[team_writer],
)
def transfer_issue(
    issue_id: int,
    payload: IssueTransfer,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Move the issue, and its sub-issues, to another team (#98).

    It takes the target team's next number, and whatever does not exist on the
    target team is remapped or cleared -- see `lib_softtrack/transfers.py`.
    Needs write access to both teams.
    """
    return transfers_service.transfer_issue(
        session, current_user, issue_id, payload.team_id
    )
