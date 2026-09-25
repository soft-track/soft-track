"""Team services, including the membership guards the other domains rely on."""

from typing import Mapping

from sqlmodel import Session, case, func, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.teams import (
    TeamCreate,
    TeamMemberAdd,
    TeamMemberRead,
    TeamMemberUpdate,
    TeamUpdate,
)
from lib_softtrack.tables import (
    Attachment,
    AutomationRule,
    Comment,
    Cycle,
    Issue,
    IssueTemplate,
    OutboundWebhook,
    Worklog,
    Project,
    Repository,
    SavedView,
    Team,
    TeamMember,
    TeamRole,
    User,
    WorkflowStatus,
)
from lib_utils.errors import ErrorCode, api_error


def get_team_or_404(team_id: int, session: Session) -> Team:
    team = session.get(Team, team_id)
    if not team:
        raise api_error(
            status_code=404, code=ErrorCode.team_not_found, detail="Team not found"
        )
    return team


def is_team_member(team_id: int, user_id: int, session: Session) -> bool:
    """Whether a user id -- not necessarily the caller's -- is on the team."""
    return (
        session.exec(
            select(TeamMember.user_id).where(
                TeamMember.team_id == team_id, TeamMember.user_id == user_id
            )
        ).first()
        is not None
    )


def require_team_member(team_id: int, user: User, session: Session) -> TeamMember:
    """Every team-scoped endpoint funnels through here; it is the tenancy boundary."""
    membership = session.exec(
        select(TeamMember).where(
            TeamMember.team_id == team_id, TeamMember.user_id == user.id
        )
    ).first()
    if not membership:
        raise api_error(
            status_code=403,
            code=ErrorCode.not_team_member,
            detail="Not a member of this team",
        )
    return membership


def require_team_admin(team_id: int, user: User, session: Session) -> TeamMember:
    """The guard for anything that changes who is in a team, or what it is called.

    A separate step after `require_team_member` rather than a flag on it, so
    that reading a team and administering it are visibly different checks at
    every call site.
    """
    membership = require_team_member(team_id, user, session)
    if membership.role != TeamRole.admin:
        raise api_error(
            status_code=403,
            code=ErrorCode.not_team_admin,
            detail="Only team admins can do that",
        )
    return membership


def require_team_writer(team_id: int, user: User, session: Session) -> TeamMember:
    """The guard for anything that changes what a team contains (#104).

    Admins and members pass; guests do not. Most routes get this from
    `app_softtrack.guards.team_writer`, which works out the team from the URL
    before the request body is even parsed. A service calls it directly only
    when a request reaches a *second* team named in its body -- linking to an
    issue elsewhere, or moving an issue to another team -- because the URL
    only says which team the request starts from.
    """
    membership = require_team_member(team_id, user, session)
    if membership.role == TeamRole.guest:
        raise api_error(
            status_code=403,
            code=ErrorCode.team_read_only,
            detail="Guests can view this team but not change it",
        )
    return membership


#: How a path parameter names the team a request acts on: the row it
#: identifies, and what to answer when there is no such row -- the same code
#: and sentence the route's own service would, so a guard running first does
#: not change what a bad id gets back. Ordered: the first one present in a
#: path wins, so `/issues/{issue_id}/links/{link_id}` resolves by the issue.
_TEAM_OWNED_BY_PATH = (
    ("issue_id", Issue, ErrorCode.issue_not_found, "Issue not found"),
    ("cycle_id", Cycle, ErrorCode.cycle_not_found, "Cycle not found"),
    ("project_id", Project, ErrorCode.project_not_found, "Project not found"),
    ("view_id", SavedView, ErrorCode.view_not_found, "View not found"),
    ("status_id", WorkflowStatus, ErrorCode.status_not_found, "Status not found"),
    ("rule_id", AutomationRule, ErrorCode.rule_not_found, "Rule not found"),
    (
        "repository_id",
        Repository,
        ErrorCode.repository_not_found,
        "Repository not found",
    ),
    ("webhook_id", OutboundWebhook, ErrorCode.webhook_not_found, "Webhook not found"),
    (
        "template_id",
        IssueTemplate,
        ErrorCode.template_not_found,
        "Template not found",
    ),
)


def team_id_for_path(session: Session, path_params: Mapping[str, str]) -> int:
    """The team a team-scoped URL is about, looked up from its path parameters.

    404s the way the route itself would when the row does not exist, so a
    guard running ahead of the handler does not change what a bad id answers.
    A path this cannot resolve is a bug in the route table rather than a bad
    request, hence the `LookupError` -- the guest sweep in
    tests/test_guest_role.py is what turns that into a failing test instead
    of a 500 in production.
    """
    # The guard runs before FastAPI has converted the path, so the values are
    # still strings. One that is not a number names no row.
    ids = {name: int(v) if v.isdigit() else 0 for name, v in path_params.items()}

    if "team_id" in ids:
        return get_team_or_404(ids["team_id"], session).id

    if "attachment_id" in ids:
        attachment = session.get(Attachment, ids["attachment_id"])
        if attachment is None:
            raise api_error(
                status_code=404,
                code=ErrorCode.attachment_not_found,
                detail="Attachment not found",
            )
        ids = {"issue_id": attachment.issue_id}

    if "worklog_id" in ids:
        worklog = session.get(Worklog, ids["worklog_id"])
        if worklog is None:
            raise api_error(
                status_code=404,
                code=ErrorCode.worklog_not_found,
                detail="Time entry not found",
            )
        ids = {"issue_id": worklog.issue_id}

    if "comment_id" in ids:
        comment = session.get(Comment, ids["comment_id"])
        if comment is None:
            raise api_error(
                status_code=404,
                code=ErrorCode.comment_not_found,
                detail="Comment not found",
            )
        ids = {"issue_id": comment.issue_id}

    for name, table, code, detail in _TEAM_OWNED_BY_PATH:
        if name in ids:
            row = session.get(table, ids[name])
            if row is None:
                raise api_error(status_code=404, code=code, detail=detail)
            return row.team_id

    raise LookupError(f"No team can be read from path parameters {sorted(path_params)}")


def _active_admin_count(session: Session, team_id: int) -> int:
    """How many admins of this team could actually sign in and use the power.

    Deactivated accounts are excluded on purpose: a team whose only other admin
    was deactivated last month is one "leave" away from having nobody who can
    add a member, and counting the dormant row would let that happen.
    """
    return session.exec(
        select(func.count())
        .select_from(TeamMember)
        .join(User, User.id == TeamMember.user_id)
        .where(
            TeamMember.team_id == team_id,
            TeamMember.role == TeamRole.admin,
            User.is_active == True,  # noqa: E712 -- SQL comparison, not a bool test
        )
    ).one()


def create_team(session: Session, current_user: User, payload: TeamCreate) -> Team:
    key = payload.key.upper()
    existing = session.exec(select(Team).where(Team.key == key)).first()
    if existing:
        raise api_error(
            status_code=400,
            code=ErrorCode.team_key_taken,
            detail="Team key already in use",
        )

    team = Team(name=payload.name, key=key, description=payload.description)
    session.add(team)
    session.commit()
    session.refresh(team)

    membership = TeamMember(
        team_id=team.id, user_id=current_user.id, role=TeamRole.admin
    )
    session.add(membership)

    # Imported here rather than at module scope: the status service imports
    # this module for its permission guards, and at module level that is a
    # cycle. A team without statuses would have nowhere to put its first
    # issue, so this is not optional setup.
    from lib_softtrack.statuses import create_default_statuses

    create_default_statuses(session, team.id)
    session.commit()

    return team


def list_teams_for_user(session: Session, current_user: User) -> list[Team]:
    statement = (
        select(Team)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(TeamMember.user_id == current_user.id)
    )
    return session.exec(statement).all()


def get_team(session: Session, current_user: User, team_id: int) -> Team:
    team = get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    return team


def update_team(
    session: Session, current_user: User, team_id: int, payload: TeamUpdate
) -> Team:
    team = get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)

    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise api_error(
                status_code=400,
                code=ErrorCode.name_required,
                detail="A team needs a name",
            )
        team.name = name
    if payload.description is not None:
        team.description = payload.description.strip() or None

    session.add(team)
    session.commit()
    session.refresh(team)
    return team


_ROLE_ORDER = case(
    (TeamMember.role == TeamRole.admin, 0),
    (TeamMember.role == TeamRole.member, 1),
    else_=2,
)


def list_team_members(
    session: Session, current_user: User, team_id: int
) -> list[TeamMemberRead]:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    # One join rather than a session.get per row: a roster is read on every
    # board load, and the per-row version made it N+1 queries deep.
    rows = session.exec(
        select(TeamMember, User)
        .join(User, User.id == TeamMember.user_id)
        .where(TeamMember.team_id == team_id)
        # Admins, members, then guests, each in the order they joined: the
        # roster reads as "who runs this team" before "who is on it", and
        # "who is only looking" last. Spelled out with a CASE because the
        # enum's own sort order is its declaration order on Postgres and
        # alphabetical on SQLite -- which would file guests above members.
        .order_by(_ROLE_ORDER, TeamMember.joined_at)
    ).all()

    return [
        TeamMemberRead(
            user=UserPublic.model_validate(user),
            role=membership.role,
            joined_at=membership.joined_at,
        )
        for membership, user in rows
    ]


def add_team_member(
    session: Session, current_user: User, team_id: int, payload: TeamMemberAdd
) -> TeamMemberRead:
    from lib_identity.identity import find_user_by_email

    get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)

    user = find_user_by_email(session, payload.email)
    if not user:
        raise api_error(
            status_code=404,
            code=ErrorCode.user_not_found,
            detail="No user with that email",
        )
    if not user.is_active:
        raise api_error(
            status_code=400,
            code=ErrorCode.account_deactivated,
            detail="That account has been deactivated",
        )

    existing = session.exec(
        select(TeamMember).where(
            TeamMember.team_id == team_id, TeamMember.user_id == user.id
        )
    ).first()
    if existing:
        raise api_error(
            status_code=400,
            code=ErrorCode.already_member,
            detail="User is already a member",
        )

    membership = TeamMember(team_id=team_id, user_id=user.id, role=payload.role)
    session.add(membership)
    session.commit()
    session.refresh(membership)

    return TeamMemberRead(
        user=UserPublic.model_validate(user),
        role=membership.role,
        joined_at=membership.joined_at,
    )


def _membership_or_404(session: Session, team_id: int, user_id: int) -> TeamMember:
    membership = session.exec(
        select(TeamMember).where(
            TeamMember.team_id == team_id, TeamMember.user_id == user_id
        )
    ).first()
    if not membership:
        raise api_error(
            status_code=404,
            code=ErrorCode.member_not_found,
            detail="Not a member of this team",
        )
    return membership


def update_team_member_role(
    session: Session,
    current_user: User,
    team_id: int,
    member_user_id: int,
    payload: TeamMemberUpdate,
) -> TeamMemberRead:
    get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)

    membership = _membership_or_404(session, team_id, member_user_id)

    demoting_an_admin = (
        membership.role == TeamRole.admin and payload.role != TeamRole.admin
    )
    if demoting_an_admin and _active_admin_count(session, team_id) <= 1:
        raise api_error(
            status_code=409,
            code=ErrorCode.last_team_admin,
            detail="A team needs at least one admin",
        )

    membership.role = payload.role
    session.add(membership)
    session.commit()
    session.refresh(membership)

    user = session.get(User, member_user_id)
    return TeamMemberRead(
        user=UserPublic.model_validate(user),
        role=membership.role,
        joined_at=membership.joined_at,
    )


def remove_team_member(
    session: Session, current_user: User, team_id: int, member_user_id: int
) -> None:
    """Remove someone from a team, or leave it yourself.

    One function for both because they are the same row and the same guards --
    only who is allowed to ask differs. Issues stay assigned to whoever left,
    the way Jira leaves them: unassigning them would quietly rewrite history
    and lose the one piece of information anybody still wants.
    """
    get_team_or_404(team_id, session)

    leaving = member_user_id == current_user.id
    if leaving:
        require_team_member(team_id, current_user, session)
    else:
        require_team_admin(team_id, current_user, session)

    membership = _membership_or_404(session, team_id, member_user_id)

    if membership.role == TeamRole.admin and _active_admin_count(session, team_id) <= 1:
        raise api_error(
            status_code=409,
            code=ErrorCode.last_team_admin,
            detail="A team needs at least one admin",
        )

    session.delete(membership)
    session.commit()
