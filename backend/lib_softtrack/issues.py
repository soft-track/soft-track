"""Issue services, including the assembly of the denormalised IssueRead payload."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.issues import IssueCreate, IssueRead, IssueUpdate
from lib_softtrack.models.page import DEFAULT_LIMIT, Page
from lib_softtrack.tables import (
    Comment,
    Issue,
    IssueLabelLink,
    IssuePriority,
    IssueStatus,
    Label,
    Team,
    User,
)
from lib_softtrack.teams import get_team_or_404, require_team_member


def issue_to_read(issue: Issue, session: Session) -> IssueRead:
    """Expand an Issue row into the shape the API returns."""
    team = session.get(Team, issue.team_id)
    assignee = session.get(User, issue.assignee_id) if issue.assignee_id else None
    creator = session.get(User, issue.creator_id)
    label_links = session.exec(
        select(IssueLabelLink).where(IssueLabelLink.issue_id == issue.id)
    ).all()
    labels = [session.get(Label, link.label_id) for link in label_links]

    return IssueRead(
        id=issue.id,
        team_id=issue.team_id,
        project_id=issue.project_id,
        number=issue.number,
        identifier=f"{team.key}-{issue.number}",
        title=issue.title,
        description=issue.description,
        status=issue.status,
        priority=issue.priority,
        assignee=UserPublic.model_validate(assignee) if assignee else None,
        creator=UserPublic.model_validate(creator),
        labels=[label for label in labels if label is not None],
        created_at=issue.created_at,
        updated_at=issue.updated_at,
    )


def set_labels(issue_id: int, label_ids: list[int], session: Session) -> None:
    existing = session.exec(
        select(IssueLabelLink).where(IssueLabelLink.issue_id == issue_id)
    ).all()
    for link in existing:
        session.delete(link)
    session.flush()
    for label_id in label_ids:
        session.add(IssueLabelLink(issue_id=issue_id, label_id=label_id))


def get_issue_or_404(session: Session, issue_id: int) -> Issue:
    issue = session.get(Issue, issue_id)
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


def create_issue(
    session: Session, current_user: User, team_id: int, payload: IssueCreate
) -> IssueRead:
    team = get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    number = team.next_issue_number
    team.next_issue_number = number + 1
    session.add(team)

    issue = Issue(
        team_id=team_id,
        project_id=payload.project_id,
        number=number,
        title=payload.title,
        description=payload.description,
        status=payload.status,
        priority=payload.priority,
        assignee_id=payload.assignee_id,
        creator_id=current_user.id,
    )
    session.add(issue)
    session.commit()
    session.refresh(issue)

    if payload.label_ids:
        set_labels(issue.id, payload.label_ids, session)
        session.commit()

    return issue_to_read(issue, session)


def list_issues(
    session: Session,
    current_user: User,
    team_id: int,
    project_id: Optional[int] = None,
    status: Optional[IssueStatus] = None,
    priority: Optional[IssuePriority] = None,
    assignee_id: Optional[int] = None,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> Page[IssueRead]:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    filters = [Issue.team_id == team_id]
    if project_id is not None:
        filters.append(Issue.project_id == project_id)
    if status is not None:
        filters.append(Issue.status == status)
    if priority is not None:
        filters.append(Issue.priority == priority)
    if assignee_id is not None:
        filters.append(Issue.assignee_id == assignee_id)

    # `total` counts everything matching the filters, not the page, so the UI
    # can show "50 of 1,204" without a second request.
    total = session.exec(select(func.count()).select_from(Issue).where(*filters)).one()

    issues = session.exec(
        select(Issue)
        .where(*filters)
        .order_by(Issue.number.desc())
        .offset(offset)
        .limit(limit)
    ).all()

    return Page(
        items=[issue_to_read(issue, session) for issue in issues],
        total=total,
        limit=limit,
        offset=offset,
    )


def get_issue(session: Session, current_user: User, issue_id: int) -> IssueRead:
    issue = get_issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)
    return issue_to_read(issue, session)


def update_issue(
    session: Session, current_user: User, issue_id: int, payload: IssueUpdate
) -> IssueRead:
    issue = get_issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)

    data = payload.model_dump(exclude_unset=True, exclude={"label_ids"})
    for field, value in data.items():
        setattr(issue, field, value)
    issue.updated_at = datetime.now(timezone.utc)
    session.add(issue)

    if payload.label_ids is not None:
        set_labels(issue.id, payload.label_ids, session)

    session.commit()
    session.refresh(issue)
    return issue_to_read(issue, session)


def delete_issue(session: Session, current_user: User, issue_id: int) -> None:
    issue = get_issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)

    # Clear the rows that point at this issue before removing it. Postgres
    # enforces these foreign keys and rejects the delete otherwise; SQLite only
    # does so with PRAGMA foreign_keys=ON, which is why this survived until the
    # stack moved to Postgres (soft-track#1).
    #
    # Done in the service rather than with ON DELETE CASCADE because the schema
    # is still created by SQLModel.metadata.create_all, so a constraint change
    # would never reach an existing database. Worth revisiting once Alembic
    # lands (soft-track#5).
    label_links = session.exec(
        select(IssueLabelLink).where(IssueLabelLink.issue_id == issue_id)
    ).all()
    for link in label_links:
        session.delete(link)

    comments = session.exec(select(Comment).where(Comment.issue_id == issue_id)).all()
    for comment in comments:
        session.delete(comment)

    session.delete(issue)
    session.commit()
