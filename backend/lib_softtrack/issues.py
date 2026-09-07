"""Issue services, including the assembly of the denormalised IssueRead payload."""

from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.issues import IssueCreate, IssueRead, IssueUpdate
from lib_softtrack.models.page import DEFAULT_LIMIT, Page
from lib_softtrack.links import open_blocker_counts
from lib_softtrack.tables import (
    Comment,
    Issue,
    IssueLabelLink,
    IssueLink,
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
        estimate=issue.estimate,
        blocked_by_count=open_blocker_counts(session, [issue.id]).get(issue.id, 0),
        creator=UserPublic.model_validate(creator),
        labels=[label for label in labels if label is not None],
        created_at=issue.created_at,
        updated_at=issue.updated_at,
    )


def _expand_issues(issues: list[Issue], session: Session) -> list[IssueRead]:
    """Build IssueRead for a page of issues with a fixed number of queries.

    `issue_to_read` is fine for one issue but costs a query per issue for its
    label links, so a page of 50 cost ~58 queries. Loading labels, users and
    teams in one query each makes the cost constant in the page size.

    (The identity map already absorbed the repeated user and team lookups when
    a page shared an assignee -- the label links were the real N+1.)
    """
    if not issues:
        return []

    issue_ids = [issue.id for issue in issues]

    labels_by_issue: dict[int, list[Label]] = defaultdict(list)
    for issue_id, label in session.exec(
        select(IssueLabelLink.issue_id, Label)
        .join(Label, Label.id == IssueLabelLink.label_id)
        .where(IssueLabelLink.issue_id.in_(issue_ids))
    ).all():
        labels_by_issue[issue_id].append(label)

    user_ids = {issue.creator_id for issue in issues}
    user_ids |= {issue.assignee_id for issue in issues if issue.assignee_id}
    users = {
        user.id: user
        for user in session.exec(select(User).where(User.id.in_(user_ids))).all()
    }

    # One query for the whole page, keeping the constant-query property.
    blocker_counts = open_blocker_counts(session, issue_ids)
    team_ids = {issue.team_id for issue in issues}
    teams = {
        team.id: team
        for team in session.exec(select(Team).where(Team.id.in_(team_ids))).all()
    }

    return [
        IssueRead(
            id=issue.id,
            team_id=issue.team_id,
            project_id=issue.project_id,
            number=issue.number,
            identifier=f"{teams[issue.team_id].key}-{issue.number}",
            title=issue.title,
            description=issue.description,
            status=issue.status,
            priority=issue.priority,
            assignee=(
                UserPublic.model_validate(users[issue.assignee_id])
                if issue.assignee_id
                else None
            ),
            estimate=issue.estimate,
            blocked_by_count=blocker_counts.get(issue.id, 0),
            creator=UserPublic.model_validate(users[issue.creator_id]),
            labels=labels_by_issue.get(issue.id, []),
            created_at=issue.created_at,
            updated_at=issue.updated_at,
        )
        for issue in issues
    ]


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
        estimate=payload.estimate,
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
        items=_expand_issues(list(issues), session),
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

    # Links point at this issue from either end, so both have to go -- and the
    # relationship is gone for the issue at the other end too, which is the
    # right outcome: it was a relationship *with* something that no longer
    # exists.
    issue_links = session.exec(
        select(IssueLink).where(
            or_(IssueLink.source_id == issue_id, IssueLink.target_id == issue_id)
        )
    ).all()
    for link in issue_links:
        session.delete(link)

    # Flush the dependent rows before removing the issue itself. Without a
    # relationship configured between these tables SQLAlchemy has no
    # dependency graph to order the deletes by, so it is free to emit the
    # parent DELETE first and trip the foreign key. The comment and label
    # deletes above happened to be ordered correctly; this makes all three
    # deterministic rather than lucky.
    session.flush()

    session.delete(issue)
    session.commit()
