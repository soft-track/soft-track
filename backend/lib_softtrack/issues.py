"""Issue services, including the assembly of the denormalised IssueRead payload."""

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import case, func, or_
from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack import attachments as attachments_service
from lib_softtrack import outbound
from lib_softtrack.models.issues import (
    IssueBulkChanges,
    IssueBulkDelete,
    IssueBulkUpdate,
    IssueMove,
    IssueCreate,
    IssueRead,
    IssueUpdate,
    ParentRef,
)
from lib_softtrack.models.page import DEFAULT_LIMIT, Page
from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.history import record_changes, record_creation, snapshot
from lib_softtrack import notifications as notifications_service
from lib_softtrack import automations as automations_service
from lib_softtrack import integrations as integrations_service
from lib_softtrack import reactions as reactions_service
from lib_softtrack import rules as rules_service
from lib_softtrack.links import open_blocker_counts
from lib_softtrack.tables import (
    Comment,
    Cycle,
    DueFilter,
    Issue,
    IssueEvent,
    IssueLabelLink,
    IssueLink,
    IssuePriority,
    IssueSort,
    IssueType,
    Label,
    Project,
    SortDirection,
    Team,
    User,
    WebhookEvent,
    WorkflowStatus,
)
from lib_softtrack.ranks import neighbour_or_404, rank_between, rank_order, top_rank
from lib_softtrack.statuses import (
    RESOLVED,
    default_status,
    in_category,
    resolve_for_team,
)
from lib_softtrack.storage import Storage
from lib_softtrack.subissues import child_progress, detach_children, validate_parent
from lib_softtrack.teams import get_team_or_404, is_team_member, require_team_member
from lib_utils.errors import ErrorCode, api_error


def _parent_ref(issue: Issue, session: Session) -> Optional[ParentRef]:
    """The breadcrumb back to a sub-issue's parent, if it has one."""
    if issue.parent_id is None:
        return None
    parent = session.get(Issue, issue.parent_id)
    if parent is None:
        return None
    team = session.get(Team, parent.team_id)
    return ParentRef(
        id=parent.id,
        team_key=team.key,
        number=parent.number,
        identifier=f"{team.key}-{parent.number}",
        title=parent.title,
    )


def issue_to_read(issue: Issue, session: Session) -> IssueRead:
    """Expand an Issue row into the shape the API returns."""
    done, total = child_progress(session, [issue.id]).get(issue.id, (0, 0))
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
        team_key=team.key,
        project_id=issue.project_id,
        number=issue.number,
        identifier=f"{team.key}-{issue.number}",
        title=issue.title,
        description=issue.description,
        status=StatusRead.model_validate(session.get(WorkflowStatus, issue.status_id)),
        priority=issue.priority,
        type=issue.type,
        rank=issue.rank,
        assignee=UserPublic.model_validate(assignee) if assignee else None,
        estimate=issue.estimate,
        blocked_by_count=open_blocker_counts(session, [issue.id]).get(issue.id, 0),
        cycle_id=issue.cycle_id,
        due_date=issue.due_date,
        external_key=issue.external_key,
        parent=_parent_ref(issue, session),
        completed_child_count=done,
        child_count=total,
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

    # One query each for blockers, sub-issue progress and the parents on this
    # page, keeping the constant-query property this function exists for.
    blocker_counts = open_blocker_counts(session, issue_ids)
    progress = child_progress(session, issue_ids)
    parent_ids = {issue.parent_id for issue in issues if issue.parent_id}
    parents = {
        parent.id: parent
        for parent in session.exec(select(Issue).where(Issue.id.in_(parent_ids))).all()
    }

    team_ids = {issue.team_id for issue in issues}
    team_ids |= {parent.team_id for parent in parents.values()}
    teams = {
        team.id: team
        for team in session.exec(select(Team).where(Team.id.in_(team_ids))).all()
    }
    statuses = {
        status.id: status
        for status in session.exec(
            select(WorkflowStatus).where(
                WorkflowStatus.id.in_({issue.status_id for issue in issues})
            )
        ).all()
    }

    return [
        IssueRead(
            id=issue.id,
            team_id=issue.team_id,
            team_key=teams[issue.team_id].key,
            project_id=issue.project_id,
            number=issue.number,
            identifier=f"{teams[issue.team_id].key}-{issue.number}",
            title=issue.title,
            description=issue.description,
            status=StatusRead.model_validate(statuses[issue.status_id]),
            priority=issue.priority,
            type=issue.type,
            rank=issue.rank,
            assignee=(
                UserPublic.model_validate(users[issue.assignee_id])
                if issue.assignee_id
                else None
            ),
            estimate=issue.estimate,
            blocked_by_count=blocker_counts.get(issue.id, 0),
            cycle_id=issue.cycle_id,
            due_date=issue.due_date,
            external_key=issue.external_key,
            creator=UserPublic.model_validate(users[issue.creator_id]),
            labels=labels_by_issue.get(issue.id, []),
            parent=_parent_ref_from(parents.get(issue.parent_id), teams),
            completed_child_count=progress.get(issue.id, (0, 0))[0],
            child_count=progress.get(issue.id, (0, 0))[1],
            created_at=issue.created_at,
            updated_at=issue.updated_at,
        )
        for issue in issues
    ]


def _parent_ref_from(parent: Optional[Issue], teams: dict) -> Optional[ParentRef]:
    if parent is None or parent.team_id not in teams:
        return None
    return ParentRef(
        id=parent.id,
        team_key=teams[parent.team_id].key,
        number=parent.number,
        identifier=f"{teams[parent.team_id].key}-{parent.number}",
        title=parent.title,
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
        raise api_error(
            status_code=404, code=ErrorCode.issue_not_found, detail="Issue not found"
        )
    return issue


def create_issue(
    session: Session, current_user: User, team_id: int, payload: IssueCreate
) -> IssueRead:
    team = get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    _require_on_team(session, Project, payload.project_id, team_id, "project")

    number = team.next_issue_number
    team.next_issue_number = number + 1
    session.add(team)

    issue = Issue(
        team_id=team_id,
        project_id=payload.project_id,
        number=number,
        title=payload.title,
        description=payload.description,
        status_id=(
            resolve_for_team(session, team_id, payload.status_id)
            or default_status(session, team_id)
        ).id,
        priority=payload.priority,
        type=payload.type,
        assignee_id=payload.assignee_id,
        estimate=payload.estimate,
        cycle_id=payload.cycle_id,
        due_date=payload.due_date,
        # On top of its column, where a new card is looked for.
        rank=top_rank(session, team_id),
        creator_id=current_user.id,
    )

    if payload.parent_id is not None:
        issue.parent_id = validate_parent(session, issue, payload.parent_id).id

    session.add(issue)
    session.commit()
    session.refresh(issue)

    record_creation(session, issue, current_user)
    notifications_service.on_issue_created(session, issue, current_user)
    outbound.emit(
        session,
        issue.team_id,
        WebhookEvent.issue_created,
        lambda: {"issue": issue_to_read(issue, session)},
        current_user,
    )
    session.commit()

    if payload.label_ids:
        set_labels(issue.id, payload.label_ids, session)
        session.commit()

    # After the labels rather than with the notifications above: a rule can
    # match on a label, and one that fired before the labels were attached
    # would be reading an issue that does not exist yet as far as the person
    # filing it is concerned.
    rules_service.on_issue_created(session, issue, current_user)
    session.commit()
    session.refresh(issue)

    return issue_to_read(issue, session)


def list_issues(
    session: Session,
    current_user: User,
    team_id: int,
    project_id: Optional[int] = None,
    status_id: Optional[int] = None,
    priority: Optional[IssuePriority] = None,
    assignee_id: Optional[int] = None,
    unassigned: bool = False,
    label_id: Optional[int] = None,
    parent_id: Optional[int] = None,
    cycle_id: Optional[int] = None,
    due: Optional[DueFilter] = None,
    today: Optional[date] = None,
    due_from: Optional[date] = None,
    due_to: Optional[date] = None,
    type: Optional[IssueType] = None,
    sort: IssueSort = IssueSort.created,
    direction: SortDirection = SortDirection.desc,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> Page[IssueRead]:
    """One page of a team's issues, narrowed by any combination of filters.

    Every filter is applied here rather than in the browser. The list is
    paginated, so a client-side filter can only ever narrow the page it
    happens to hold -- "urgent issues" would mean "urgent issues among the
    fifty most recent", which is a different and much less useful thing, and
    silently so.
    """
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    filters = [Issue.team_id == team_id]
    if project_id is not None:
        filters.append(Issue.project_id == project_id)
    if status_id is not None:
        filters.append(Issue.status_id == status_id)
    if priority is not None:
        filters.append(Issue.priority == priority)
    if unassigned:
        # Distinct from leaving assignee_id null, which means "anybody".
        filters.append(Issue.assignee_id == None)  # noqa: E711 -- SQL IS NULL
    elif assignee_id is not None:
        filters.append(Issue.assignee_id == assignee_id)
    if label_id is not None:
        # A subquery rather than a join: an issue joined to its label links
        # would come back once per matching link, and the count above would
        # count it that many times.
        filters.append(
            Issue.id.in_(
                select(IssueLabelLink.issue_id).where(
                    IssueLabelLink.label_id == label_id
                )
            )
        )
    if parent_id is not None:
        filters.append(Issue.parent_id == parent_id)
    if cycle_id is not None:
        filters.append(Issue.cycle_id == cycle_id)
    if type is not None:
        filters.append(Issue.type == type)
    if due is not None:
        filters.append(_due_filter(due, today or datetime.now(timezone.utc).date()))
    # A date range, both ends inclusive (#105): the calendar asks for the days
    # its grid shows. Either end alone is an open range.
    if due_from is not None:
        filters.append(Issue.due_date >= due_from)
    if due_to is not None:
        filters.append(Issue.due_date <= due_to)

    # `total` counts everything matching the filters, not the page, so the UI
    # can show "50 of 1,204" without a second request.
    total = session.exec(select(func.count()).select_from(Issue).where(*filters)).one()

    issues = session.exec(
        select(Issue)
        .where(*filters)
        .order_by(*_ordering(sort, direction, rank_order(session)))
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


def get_issue_by_number(
    session: Session, current_user: User, team_id: int, number: int
) -> IssueRead:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    issue = session.exec(
        select(Issue).where(Issue.team_id == team_id, Issue.number == number)
    ).one_or_none()
    if not issue:
        raise api_error(
            status_code=404, code=ErrorCode.issue_not_found, detail="Issue not found"
        )
    return issue_to_read(issue, session)


def update_issue(
    session: Session, current_user: User, issue_id: int, payload: IssueUpdate
) -> IssueRead:
    issue = get_issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)

    _apply_update(
        session,
        current_user,
        issue,
        payload.model_dump(exclude_unset=True, exclude={"label_ids"}),
        payload.label_ids,
    )

    session.commit()
    session.refresh(issue)
    return issue_to_read(issue, session)


def _apply_update(
    session: Session,
    current_user: User,
    issue: Issue,
    data: dict,
    label_ids: Optional[list[int]],
) -> None:
    """Change one issue and everything that follows from it, without committing.

    Shared by the single PATCH and the bulk edit, so an issue changed twenty
    at a time gets the same history, notifications and automation runs as one
    changed by hand. Committing is the caller's job: the bulk edit needs every
    issue's changes in one transaction.
    """
    before = snapshot(issue)
    hook_before = outbound.snapshot(issue)
    # Three snapshots of the same row, and three different questions about it.
    # History tracks what can be charted, notifications track what somebody
    # would want to be told about, and automation tracks what a rule can fire
    # on. They overlap without being the same list, and folding them together
    # would mean every field added to one answer being added to all three.
    watched_before = notifications_service.snapshot(issue)
    rule_before = rules_service.snapshot(issue)
    if data.get("status_id") is not None:
        # Moving an issue into another team's column would take it off its own
        # board entirely.
        resolve_for_team(session, issue.team_id, data["status_id"])
    if data.get("parent_id") is not None:
        # Validate before assigning, so a rejected parent leaves the issue
        # exactly as it was rather than half-updated.
        validate_parent(session, issue, data["parent_id"])
    # The check the bulk edit makes up front, made here for the single PATCH
    # too: another team's project satisfies the foreign key, and would file
    # the issue under an epic its own team cannot open.
    _require_on_team(session, Project, data.get("project_id"), issue.team_id, "project")
    for field, value in data.items():
        setattr(issue, field, value)
    issue.updated_at = datetime.now(timezone.utc)
    session.add(issue)

    if label_ids is not None:
        set_labels(issue.id, label_ids, session)

    record_changes(session, issue, before, current_user)
    notifications_service.on_issue_updated(session, issue, watched_before, current_user)
    # Before the rules run, so what a person did and what a rule then did
    # arrive as separate deliveries -- the same split history keeps.
    outbound.issue_changed(session, issue, hook_before, current_user)
    # Last, so a rule reads the issue as the update left it -- and so its own
    # changes are recorded as a separate step in the history rather than
    # folded into the one the person made.
    rules_service.on_issue_updated(session, issue, rule_before, current_user)


#: Most urgent highest, so "descending" reads as "most urgent first" -- the
#: way a person means "sort by priority".
_PRIORITY_RANK = {
    IssuePriority.urgent: 4,
    IssuePriority.high: 3,
    IssuePriority.medium: 2,
    IssuePriority.low: 1,
    IssuePriority.no_priority: 0,
}


def _ordering(sort: IssueSort, direction: SortDirection, rank) -> list:
    """ORDER BY for the issue list (#88).

    Every ordering ends on the issue number, newest first, so issues that
    tie -- the same priority, no estimate -- come back in a stable order
    and a page boundary never splits or repeats them.
    """
    descending = direction == SortDirection.desc
    newest_first = Issue.number.desc()
    if sort == IssueSort.created:
        return [newest_first if descending else Issue.number.asc()]
    if sort == IssueSort.rank:
        key = rank
    elif sort == IssueSort.updated:
        key = Issue.updated_at
    elif sort == IssueSort.priority:
        key = case(
            *[(Issue.priority == p, rank) for p, rank in _PRIORITY_RANK.items()],
            else_=0,
        )
    elif sort == IssueSort.title:
        key = func.lower(Issue.title)
    else:
        # Unsized last whichever way round: an estimate of "none" is not a
        # small estimate, and sorting it among the ones would say it was.
        return [
            Issue.estimate.is_(None),
            Issue.estimate.desc() if descending else Issue.estimate.asc(),
            newest_first,
        ]
    return [key.desc() if descending else key.asc(), newest_first]


def _due_filter(due: DueFilter, today: date):
    """One of the three due-date questions, as a condition on Issue (#87)."""
    if due == DueFilter.none:
        return Issue.due_date == None  # noqa: E711 -- SQL IS NULL
    if due == DueFilter.overdue:
        # Late only while it is still open: finished work is not overdue,
        # however late it was finished.
        return (Issue.due_date < today) & ~in_category(*RESOLVED)
    # Monday is 0, so this is the coming Sunday -- or today, on a Sunday.
    end_of_week = today + timedelta(days=6 - today.weekday())
    return (Issue.due_date >= today) & (Issue.due_date <= end_of_week)


def move_issue(
    session: Session, current_user: User, issue_id: int, payload: IssueMove
) -> IssueRead:
    """Drop a card between two others on the board, maybe in another column.

    One row changes: the card's own rank, between its new neighbours'. A
    change of column goes through the ordinary update path first, so it
    records history, notifies and runs rules exactly as a status change from
    the issue panel does.
    """
    issue = get_issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)
    above = neighbour_or_404(session, issue, payload.above_id)
    below = neighbour_or_404(session, issue, payload.below_id)

    if payload.status_id is not None and payload.status_id != issue.status_id:
        _apply_update(
            session, current_user, issue, {"status_id": payload.status_id}, None
        )

    if above is None and below is None:
        # An empty column, or nothing said: the top, like a new card.
        issue.rank = top_rank(session, issue.team_id)
    else:
        issue.rank = rank_between(session, above, below)
    issue.updated_at = datetime.now(timezone.utc)
    session.add(issue)
    session.commit()
    session.refresh(issue)
    return issue_to_read(issue, session)


def delete_issue(
    session: Session, current_user: User, issue_id: int, storage: Storage
) -> None:
    issue = get_issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)

    storage_keys = _delete_rows(session, issue)
    session.commit()

    attachments_service.purge(storage, storage_keys)


def _delete_rows(session: Session, issue: Issue) -> list[str]:
    """Remove one issue and its dependents, without committing.

    Returns the attachment keys whose bytes should be purged once the caller
    has committed -- see `attachments.take_keys_for_issue`.
    """
    issue_id = issue.id

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

    # Before the comments below, and flushed rather than left queued: a
    # notification holds a foreign key to the comment it is about, and with no
    # relationship configured between the two tables SQLAlchemy has no
    # dependency graph to order one flush's DELETEs by. Emitting these now is
    # what makes "notifications first" true of the SQL and not just of the
    # Python -- the distinction that let soft-track#1 through.
    notifications_service.delete_for_issue(session, issue_id)
    # Same reasoning, same place: a run-log row about an issue that no longer
    # exists is a link to a 404, and it holds a foreign key to this row.
    automations_service.delete_runs_for_issue(session, issue_id)
    # And the branches, commits and pull requests linked to it. Same reason
    # again: the rows hold a foreign key here, and a link to the code for an
    # issue that no longer exists is not worth keeping.
    integrations_service.delete_links_for_issue(session, issue_id)
    # And the time logged against it (#102). Imported here because the
    # worklog service reads issues through this module.
    from lib_softtrack import worklogs as worklogs_service

    worklogs_service.delete_for_issue(session, issue_id)
    session.flush()

    # Attachments before comments: a comment attachment holds a foreign key to
    # the comment, so removing the comment first is the delete Postgres
    # rejects. The bytes are purged after the commit below -- an orphaned file
    # costs disk, an orphaned row costs a broken image on somebody's issue.
    storage_keys = attachments_service.take_keys_for_issue(session, issue_id)

    # Reactions hold a foreign key to the comment, so they go first -- and are
    # flushed first, for the reason given for notifications above.
    reactions_service.delete_for_issue(session, issue_id)
    session.flush()

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

    # History rows point at the issue, so they go with it. There is no
    # reporting value in events for an issue that no longer exists, and
    # keeping them would mean every report having to tolerate dangling ids.
    for event in session.exec(
        select(IssueEvent).where(IssueEvent.issue_id == issue_id)
    ).all():
        session.delete(event)

    # Children are promoted to top level rather than deleted. Losing a parent
    # should not lose the work underneath it -- that is a lot of data to
    # destroy with one click, and the children are usually the part worth
    # keeping. They also hold a foreign key to this row, so they have to be
    # dealt with either way.
    detach_children(session, issue_id)

    # Flush every dependent change before removing the issue itself. Without a
    # relationship configured between these tables SQLAlchemy has no
    # dependency graph to order the statements by, so it is free to emit the
    # parent DELETE first and trip a foreign key. The comment and label
    # deletes above happened to be ordered correctly; this makes all of them
    # deterministic rather than lucky.
    session.flush()

    session.delete(issue)
    return storage_keys


# ---------------------------------------------------------------------------
# Bulk edit
# ---------------------------------------------------------------------------


def _team_issues_or_404(
    session: Session, team_id: int, issue_ids: list[int]
) -> list[Issue]:
    """Every requested issue, in the order asked for, or a 404 for all of them.

    Scoped to the team in the path: an id from another team is reported as
    not found rather than forbidden, the same answer a single GET gives, so
    the endpoint cannot be used to probe which ids exist elsewhere.
    """
    wanted = list(dict.fromkeys(issue_ids))
    found = {
        issue.id: issue
        for issue in session.exec(
            select(Issue).where(Issue.team_id == team_id, Issue.id.in_(wanted))
        ).all()
    }
    missing = [issue_id for issue_id in wanted if issue_id not in found]
    if missing:
        raise api_error(
            status_code=404,
            code=ErrorCode.issues_not_found,
            detail="Issues not found on this team: "
            + ", ".join(str(issue_id) for issue_id in missing),
        )
    return [found[issue_id] for issue_id in wanted]


def _require_on_team(
    session: Session, model: type, row_id: Optional[int], team_id: int, noun: str
) -> None:
    """A project, cycle or label id from the request, checked against the team.

    Checked once up front rather than left to the foreign key: a row from
    another team satisfies the foreign key and would quietly file twenty
    issues somewhere their own board cannot see.
    """
    if row_id is None:
        return
    row = session.get(model, row_id)
    if row is None or row.team_id != team_id:
        raise api_error(
            status_code=400,
            code=ErrorCode.not_on_this_team,
            detail=f"No such {noun} on this team",
        )


def _validate_bulk_changes(
    session: Session, team_id: int, changes: IssueBulkChanges
) -> None:
    resolve_for_team(session, team_id, changes.status_id)
    _require_on_team(session, Project, changes.project_id, team_id, "project")
    _require_on_team(session, Cycle, changes.cycle_id, team_id, "cycle")
    for label_id in {*changes.add_label_ids, *changes.remove_label_ids}:
        _require_on_team(session, Label, label_id, team_id, "label")
    if set(changes.add_label_ids) & set(changes.remove_label_ids):
        raise api_error(
            status_code=400,
            code=ErrorCode.labels_conflict,
            detail="A label cannot be both added and removed.",
        )
    if changes.assignee_id is not None and not is_team_member(
        team_id, changes.assignee_id, session
    ):
        raise api_error(
            status_code=400,
            code=ErrorCode.user_not_on_team,
            detail="The assignee is not a member of this team.",
        )


def _bulk_label_ids(
    session: Session, issue: Issue, add: list[int], remove: list[int]
) -> Optional[list[int]]:
    """The issue's label set after the add and remove, or None if unchanged."""
    if not add and not remove:
        return None
    current = set(
        session.exec(
            select(IssueLabelLink.label_id).where(IssueLabelLink.issue_id == issue.id)
        ).all()
    )
    wanted = (current | set(add)) - set(remove)
    return sorted(wanted) if wanted != current else None


def bulk_update_issues(
    session: Session, current_user: User, team_id: int, payload: IssueBulkUpdate
) -> list[IssueRead]:
    """Apply one set of changes to many issues, all of them or none.

    Everything that can be checked once is checked before anything changes.
    What can only fail per issue fails inside the transaction, and the whole
    batch is rolled back rather than leaving the first half changed: a bulk
    edit that stops partway leaves somebody to work out which half landed.
    """
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    issues = _team_issues_or_404(session, team_id, payload.issue_ids)

    changes = payload.changes
    _validate_bulk_changes(session, team_id, changes)
    data = changes.model_dump(
        exclude_unset=True, exclude={"add_label_ids", "remove_label_ids"}
    )
    # Status and priority have no "cleared" state, so a null for either is
    # read as "leave it alone" rather than written to a non-null column.
    for field in ("status_id", "priority"):
        if data.get(field, ...) is None:
            del data[field]

    try:
        for issue in issues:
            _apply_update(
                session,
                current_user,
                issue,
                data,
                _bulk_label_ids(
                    session, issue, changes.add_label_ids, changes.remove_label_ids
                ),
            )
        session.commit()
    except Exception:
        session.rollback()
        raise

    return _expand_issues(issues, session)


def bulk_delete_issues(
    session: Session,
    current_user: User,
    team_id: int,
    payload: IssueBulkDelete,
    storage: Storage,
) -> None:
    """Delete many issues in one transaction, then purge their attachments.

    Deleting a parent and one of its sub-issues in the same batch is fine in
    either order: the parent's delete promotes the child, and the child's
    delete removes it.
    """
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    issues = _team_issues_or_404(session, team_id, payload.issue_ids)

    storage_keys: list[str] = []
    try:
        for issue in issues:
            storage_keys += _delete_rows(session, issue)
        session.commit()
    except Exception:
        session.rollback()
        raise

    attachments_service.purge(storage, storage_keys)
