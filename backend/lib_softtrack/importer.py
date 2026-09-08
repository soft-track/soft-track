"""Applying a parsed export to a team.

A dry run and a real run take the same path and build the same report; the
only difference is that a dry run rolls back at the end. That is deliberate:
a preview produced by a different code path is a preview of something else,
and the whole point of the dry run is to be able to trust what it says.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from lib_softtrack.history import record_creation
from lib_softtrack.jira import JiraParseError, parse
from lib_softtrack import statuses as statuses_service
from lib_softtrack.models.imports import ImportReport, ParsedIssue, UserMatch
from lib_softtrack.tables import (
    Comment,
    Issue,
    IssueLabelLink,
    Label,
    Project,
    Team,
    TeamMember,
    User,
)
from lib_softtrack.teams import get_team_or_404, require_team_member

#: Colours cycled through for labels created by an import, so an imported
#: board does not arrive entirely grey.
_LABEL_COLOURS = [
    "#6342db",
    "#12a474",
    "#ef9d0b",
    "#e0424a",
    "#3f82f6",
    "#8b5cf6",
]

PREVIEW_LIMIT = 10


def _match_users(
    session: Session, team_id: int, names: set[str]
) -> tuple[dict[str, User], list[UserMatch]]:
    """Match people named in the export to members of this team.

    Email first, because it is the only identifier that is actually stable.
    Display name second, and only against team members -- matching a name
    across the whole install could quietly assign work to a stranger who
    happens to share a name with someone's colleague.
    """
    members = session.exec(
        select(User)
        .join(TeamMember, TeamMember.user_id == User.id)
        .where(TeamMember.team_id == team_id)
    ).all()
    by_email = {user.email.lower(): user for user in members}
    by_name = {user.full_name.strip().lower(): user for user in members}

    matched: dict[str, User] = {}
    report: list[UserMatch] = []
    for name in sorted(names):
        key = name.strip().lower()
        user = by_email.get(key)
        how: Optional[str] = "email" if user else None
        if user is None:
            user = by_name.get(key)
            how = "name" if user else None

        if user is not None:
            matched[name] = user
        report.append(
            UserMatch(
                source=name,
                matched_user_id=user.id if user else None,
                matched_email=user.email if user else None,
                matched_by=how,
            )
        )
    return matched, report


def _label_for(
    session: Session,
    team_id: int,
    name: str,
    cache: dict[str, Label],
    created: list[str],
) -> Label:
    key = name.strip().lower()
    if key in cache:
        return cache[key]

    existing = session.exec(select(Label).where(Label.team_id == team_id)).all()
    for label in existing:
        if label.name.strip().lower() == key:
            cache[key] = label
            return label

    label = Label(
        team_id=team_id,
        name=name.strip(),
        color=_LABEL_COLOURS[len(created) % len(_LABEL_COLOURS)],
    )
    session.add(label)
    session.flush()
    cache[key] = label
    created.append(label.name)
    return label


def _project_for(
    session: Session,
    team_id: int,
    name: str,
    cache: dict[str, Project],
    created: list[str],
) -> Project:
    key = name.strip().lower()
    if key in cache:
        return cache[key]

    for project in session.exec(
        select(Project).where(Project.team_id == team_id)
    ).all():
        if project.name.strip().lower() == key:
            cache[key] = project
            return project

    project = Project(team_id=team_id, name=name.strip())
    session.add(project)
    session.flush()
    cache[key] = project
    created.append(project.name)
    return project


def import_export(
    session: Session,
    current_user: User,
    team_id: int,
    filename: str,
    content: str,
    dry_run: bool = True,
) -> ImportReport:
    team = get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    try:
        parsed = parse(filename, content)
    except JiraParseError as error:
        raise HTTPException(status_code=422, detail=str(error))

    if not parsed:
        raise HTTPException(status_code=422, detail="No issues found in that file.")

    people = {
        name for issue in parsed for name in (issue.assignee, issue.reporter) if name
    } | {
        comment.author
        for issue in parsed
        for comment in issue.comments
        if comment.author
    }
    matched_users, user_report = _match_users(session, team_id, people)

    existing_keys = {
        issue.external_key
        for issue in session.exec(
            select(Issue).where(
                Issue.team_id == team_id, Issue.external_key.is_not(None)
            )
        ).all()
    }

    report = ImportReport(
        dry_run=dry_run,
        issues_found=len(parsed),
        issues_created=0,
        issues_skipped_existing=0,
        comments_created=0,
        labels_created=[],
        projects_created=[],
        users=user_report,
        unmapped_statuses=[],
        unmapped_priorities=[],
        warnings=[],
        preview=parsed[:PREVIEW_LIMIT],
    )

    unmapped_statuses: set[str] = set()
    unmapped_priorities: set[str] = set()
    label_cache: dict[str, Label] = {}
    project_cache: dict[str, Project] = {}
    seen_keys: set[str] = set()

    for parsed_issue in parsed:
        if parsed_issue.raw_status:
            unmapped_statuses.add(parsed_issue.raw_status)
        if parsed_issue.raw_priority:
            unmapped_priorities.add(parsed_issue.raw_priority)

        key = parsed_issue.external_key
        # Re-importing the same export must not duplicate the board. Skipping
        # on the key is what makes an import safe to retry after a partial
        # failure.
        if key and (key in existing_keys or key in seen_keys):
            report.issues_skipped_existing += 1
            continue
        if key:
            seen_keys.add(key)

        issue = _create_issue(
            session,
            team,
            parsed_issue,
            matched_users,
            current_user,
            label_cache,
            project_cache,
            report,
        )
        report.issues_created += 1
        report.comments_created += _create_comments(
            session, issue, parsed_issue, matched_users, current_user
        )

    report.unmapped_statuses = sorted(unmapped_statuses)
    report.unmapped_priorities = sorted(unmapped_priorities)
    report.warnings = _warnings(report, parsed)

    if dry_run:
        # Everything above ran for real against the session; rolling back is
        # what makes it a preview. Nothing reaches the database.
        session.rollback()
    else:
        session.commit()

    return report


def _create_issue(
    session: Session,
    team: Team,
    parsed_issue: ParsedIssue,
    matched_users: dict[str, User],
    actor: User,
    label_cache: dict[str, Label],
    project_cache: dict[str, Project],
    report: ImportReport,
) -> Issue:
    number = team.next_issue_number
    team.next_issue_number = number + 1
    session.add(team)

    project = None
    if parsed_issue.epic:
        project = _project_for(
            session, team.id, parsed_issue.epic, project_cache, report.projects_created
        )

    assignee = matched_users.get(parsed_issue.assignee or "")
    # An unmatched reporter falls back to whoever ran the import, because
    # creator_id is not nullable and the alternative is refusing the whole
    # file over one departed colleague.
    creator = matched_users.get(parsed_issue.reporter or "") or actor

    issue = Issue(
        team_id=team.id,
        number=number,
        title=parsed_issue.title[:500],
        description=parsed_issue.description,
        status_id=_status_for(session, team.id, parsed_issue).id,
        priority=parsed_issue.priority,
        assignee_id=assignee.id if assignee else None,
        creator_id=creator.id,
        project_id=project.id if project else None,
        external_key=parsed_issue.external_key,
        created_at=_aware(parsed_issue.created_at),
        updated_at=_aware(parsed_issue.updated_at or parsed_issue.created_at),
    )
    session.add(issue)
    session.flush()

    for name in parsed_issue.labels:
        label = _label_for(session, team.id, name, label_cache, report.labels_created)
        session.add(IssueLabelLink(issue_id=issue.id, label_id=label.id))

    record_creation(session, issue, actor)
    return issue


def _create_comments(
    session: Session,
    issue: Issue,
    parsed_issue: ParsedIssue,
    matched_users: dict[str, User],
    actor: User,
) -> int:
    for comment in parsed_issue.comments:
        author = matched_users.get(comment.author or "") or actor
        body = comment.body
        # Say who wrote it when we could not match them, rather than silently
        # attributing a colleague's words to whoever ran the import.
        if comment.author and comment.author not in matched_users:
            body = f"**{comment.author}** (imported):\n\n{body}"
        session.add(
            Comment(
                issue_id=issue.id,
                author_id=author.id,
                body=body,
                created_at=_aware(comment.created_at),
            )
        )
    return len(parsed_issue.comments)


def _aware(value: Optional[datetime]) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _warnings(report: ImportReport, parsed: list[ParsedIssue]) -> list[str]:
    warnings: list[str] = []

    unmatched = [
        match.source for match in report.users if match.matched_user_id is None
    ]
    if unmatched:
        warnings.append(
            f"{len(unmatched)} person(s) in this export are not members of this "
            "team, so their issues will be unassigned and their comments "
            "attributed to you with their name kept in the text: "
            + ", ".join(unmatched[:5])
            + ("…" if len(unmatched) > 5 else "")
        )

    if report.unmapped_statuses:
        warnings.append(
            "These statuses have no equivalent and will land in the first "
            "column: " + ", ".join(report.unmapped_statuses)
        )

    without_key = sum(1 for issue in parsed if not issue.external_key)
    if without_key:
        warnings.append(
            f"{without_key} issue(s) have no Jira key, so re-running this "
            "import would create them again. Export with the 'Issue key' "
            "column to make the import repeatable."
        )

    if report.issues_skipped_existing:
        warnings.append(
            f"{report.issues_skipped_existing} issue(s) are already imported "
            "and will be left alone."
        )

    return warnings


def _status_for(session: Session, team_id: int, parsed_issue: ParsedIssue):
    """Which of the team's columns an imported issue lands in.

    Three tries, in order of how much they preserve:

    1. **A column the team already calls the same thing.** A team whose board
       has "In Review" should get Jira's "In Review" issues in it, not merged
       into whatever else happens to be `started`. This is what makes the
       importer worth teaching about custom statuses at all.
    2. **The first column meaning the same thing.** The parser mapped the Jira
       status to a category; any column in that category is a defensible home.
    3. **The team's first column.** An unmapped status is still an issue, and
       losing it would be far worse than putting it in the wrong place. The
       report names these so they can be fixed in bulk.
    """
    statuses = statuses_service.team_statuses(session, team_id)

    if parsed_issue.raw_status:
        wanted = parsed_issue.raw_status.strip().casefold()
        for status in statuses:
            if status.name.casefold() == wanted:
                return status

    for status in statuses:
        if status.category is parsed_issue.status:
            return status

    return statuses[0]
