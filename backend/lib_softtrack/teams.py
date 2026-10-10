"""Team services, including the membership guards the other domains rely on."""

from typing import Mapping, Optional

from sqlmodel import Session, case, delete, func, select

from lib_identity.models.identity import UserPublic
from lib_softtrack import outside
from lib_softtrack.models.teams import (
    EpicRef,
    TeamCreate,
    TeamDirectoryEntry,
    TeamMemberAdd,
    TeamMemberRead,
    TeamMemberUpdate,
    TeamUpdate,
)
from lib_softtrack.tables import (
    Attachment,
    AutomationRule,
    AutomationRun,
    Comment,
    CustomField,
    CustomFieldValue,
    CodeLink,
    GuestEpic,
    Label,
    Sprint,
    SprintAction,
    Ticket,
    TicketEvent,
    TicketTemplate,
    OutboundWebhook,
    UserDefaultView,
    WebhookDelivery,
    Worklog,
    Project,
    Repository,
    SavedView,
    ShareLink,
    Team,
    TeamInvite,
    TeamMember,
    TeamRole,
    User,
    WorkflowStatus,
)
from lib_softtrack.trash import INCLUDE_TRASHED
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


def _role_on(team_id: int, user_id: int, session: Session) -> Optional[TeamRole]:
    return session.exec(
        select(TeamMember.role).where(
            TeamMember.team_id == team_id, TeamMember.user_id == user_id
        )
    ).first()


def can_be_assigned(team_id: int, user_id: int, session: Session) -> bool:
    """Whether somebody may hold one of the team's tickets (#316).

    An admin or a member. A guest is on the team to read it and could not move
    the ticket along, and somebody on no team could not even open it. Every
    path that puts a name on a ticket comes through here or through
    `require_assignable`: creating one, editing one or many, a rule, a move
    from another team, an import, and handing work on when somebody leaves.
    """
    role = _role_on(team_id, user_id, session)
    return role is not None and role != TeamRole.guest


def require_assignable(team_id: int, user_id: Optional[int], session: Session) -> None:
    """Refuse an assignee who may not hold the team's tickets. None is nobody."""
    if user_id is None:
        return
    role = _role_on(team_id, user_id, session)
    if role is None:
        raise api_error(
            status_code=400,
            code=ErrorCode.user_not_on_team,
            detail="The assignee is not a member of this team.",
        )
    if role == TeamRole.guest:
        # The same code as a stranger: to a client both mean "pick somebody
        # else". The sentence says which it was.
        raise api_error(
            status_code=400,
            code=ErrorCode.user_not_on_team,
            detail="Guests can view this team but not be assigned its tickets.",
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


def require_team_not_archived(team_id: int, session: Session) -> Team:
    """Reject mutations on archived teams, regardless of the caller's role."""
    team = get_team_or_404(team_id, session)
    if team.archived:
        raise api_error(
            status_code=403,
            code=ErrorCode.team_read_only,
            detail="This team is archived, so it can only be restored",
        )
    return team


def require_team_writer(team_id: int, user: User, session: Session) -> TeamMember:
    """Guard writes to a team's contents (#104).

    Admins and members pass; guests do not. Archived teams are read-only,
    including for admins and members. The PATCH service handles restoration.

    When an operation also references another team in its request body (for
    example, linking a ticket to a ticket in another team or moving a ticket),
    call this helper directly for that second team as well. A path dependency
    can only guard the team identified by the URL.
    """
    membership = require_team_member(team_id, user, session)
    require_team_not_archived(team_id, session)
    if membership.role == TeamRole.guest:
        raise api_error(
            status_code=403,
            code=ErrorCode.team_read_only,
            detail="Guests can view this team but not change it",
        )
    return membership


def require_team_commenter(team_id: int, user: User, session: Session) -> TeamMember:
    """The guard for joining a ticket's conversation (#244).

    Admins and members pass, like `require_team_writer`. A guest passes too on
    a team that lets its guests comment: they may write, react, attach files
    to their comments and edit or delete their own, and still change nothing
    else. The services decide what "their own" covers.
    """
    membership = require_team_member(team_id, user, session)
    require_team_not_archived(team_id, session)
    if membership.role == TeamRole.guest:
        team = session.get(Team, team_id)
        if not team.guests_may_comment:
            raise api_error(
                status_code=403,
                code=ErrorCode.team_read_only,
                detail="Guests of this team read the conversation and do not "
                "comment",
            )
    return membership


#: How a path parameter names the team a request acts on: the row it
#: identifies, and what to answer when there is no such row -- the same code
#: and sentence the route's own service would, so a guard running first does
#: not change what a bad id gets back. Ordered: the first one present in a
#: path wins, so `/tickets/{ticket_id}/links/{link_id}` resolves by the ticket.
_TEAM_OWNED_BY_PATH = (
    ("ticket_id", Ticket, ErrorCode.ticket_not_found, "Ticket not found"),
    ("sprint_id", Sprint, ErrorCode.sprint_not_found, "Sprint not found"),
    ("project_id", Project, ErrorCode.project_not_found, "Project not found"),
    ("view_id", SavedView, ErrorCode.view_not_found, "View not found"),
    ("status_id", WorkflowStatus, ErrorCode.status_not_found, "Status not found"),
    ("label_id", Label, ErrorCode.label_not_found, "Label not found"),
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
        TicketTemplate,
        ErrorCode.template_not_found,
        "Template not found",
    ),
    ("field_id", CustomField, ErrorCode.custom_field_not_found, "Field not found"),
    (
        "share_link_id",
        ShareLink,
        ErrorCode.share_link_not_found,
        "Share link not found",
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
        ids = {"ticket_id": attachment.ticket_id}

    if "worklog_id" in ids:
        worklog = session.get(Worklog, ids["worklog_id"])
        if worklog is None:
            raise api_error(
                status_code=404,
                code=ErrorCode.worklog_not_found,
                detail="Time entry not found",
            )
        ids = {"ticket_id": worklog.ticket_id}

    if "comment_id" in ids:
        comment = session.get(Comment, ids["comment_id"])
        if comment is None:
            raise api_error(
                status_code=404,
                code=ErrorCode.comment_not_found,
                detail="Comment not found",
            )
        ids = {"ticket_id": comment.ticket_id}

    for name, table, code, detail in _TEAM_OWNED_BY_PATH:
        if name in ids:
            # The trash too (#323): restoring and purging name a row in it,
            # and which team it is on is the question here either way.
            row = session.get(table, ids[name], execution_options=INCLUDE_TRASHED)
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
    # ticket, so this is not optional setup.
    from lib_softtrack.statuses import create_default_statuses

    create_default_statuses(session, team.id)
    session.commit()

    return team


def list_teams_for_user(session: Session, current_user: User) -> list[Team]:
    statement = (
        select(Team)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(TeamMember.user_id == current_user.id, Team.archived == False)
    )
    return session.exec(statement).all()


def team_directory(session: Session) -> list[TeamDirectoryEntry]:
    """Every team on the instance, with how many are on it and who runs it.

    For somebody on no team (#318), who needs to know whom to ask to be added.
    The same kind of thing the people directory already shows anybody signed
    in: names and people, not work. Three queries however many teams there
    are. Deactivated accounts are left out of both the count and the admins,
    since neither can add anybody.
    """
    teams = session.exec(
        select(Team).where(Team.archived == False).order_by(func.lower(Team.name))
    ).all()
    counts = dict(
        session.exec(
            select(TeamMember.team_id, func.count())
            .join(User, User.id == TeamMember.user_id)
            .where(User.is_active == True)  # noqa: E712 -- SQL comparison
            .group_by(TeamMember.team_id)
        ).all()
    )
    admins: dict[int, list[UserPublic]] = {}
    for team_id, user in session.exec(
        select(TeamMember.team_id, User)
        .join(User, User.id == TeamMember.user_id)
        .where(
            TeamMember.role == TeamRole.admin,
            User.is_active == True,  # noqa: E712 -- SQL comparison
        )
        .order_by(TeamMember.joined_at)
    ).all():
        admins.setdefault(team_id, []).append(UserPublic.model_validate(user))
    return [
        TeamDirectoryEntry(
            id=team.id,
            name=team.name,
            key=team.key,
            description=team.description,
            member_count=counts.get(team.id, 0),
            admins=admins.get(team.id, []),
        )
        for team in teams
    ]


def get_team(session: Session, current_user: User, team_id: int) -> Team:
    team = get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    return team


def delete_team(session: Session, current_user: User, team_id: int) -> None:
    """Delete an empty team, removing its own config and memberships.

    The team row is kept alive until the very end so every team-owned child row
    can be removed in one transaction without leaving dangling references.
    """
    team = require_team_not_archived(team_id, session)
    if not current_user.is_site_admin:
        require_team_admin(team_id, current_user, session)

    has_tickets = session.exec(
        select(Ticket.id)
        .where(Ticket.team_id == team_id)
        .limit(1)
        .execution_options(**INCLUDE_TRASHED)
    ).first()
    if has_tickets is not None:
        raise api_error(
            status_code=409,
            code=ErrorCode.team_has_tickets,
            detail="This team still has tickets and cannot be deleted; archive it instead",
        )

    repository_ids = session.exec(
        select(Repository.id).where(Repository.team_id == team_id)
    ).all()
    if repository_ids:
        session.exec(delete(CodeLink).where(CodeLink.repository_id.in_(repository_ids)))

    webhook_ids = session.exec(
        select(OutboundWebhook.id).where(OutboundWebhook.team_id == team_id)
    ).all()
    if webhook_ids:
        session.exec(
            delete(WebhookDelivery).where(WebhookDelivery.webhook_id.in_(webhook_ids))
        )

    if team.default_view_id is not None:
        team.default_view_id = None
        session.add(team)

    # Remove rows that retain references to the team or its children.
    session.exec(delete(ShareLink).where(ShareLink.team_id == team_id))
    session.exec(delete(TicketEvent).where(TicketEvent.team_id == team_id))

    sprint_ids = session.exec(select(Sprint.id).where(Sprint.team_id == team_id)).all()
    if sprint_ids:
        session.exec(delete(SprintAction).where(SprintAction.sprint_id.in_(sprint_ids)))

    project_ids = session.exec(
        select(Project.id).where(Project.team_id == team_id)
    ).all()
    if project_ids:
        session.exec(delete(GuestEpic).where(GuestEpic.project_id.in_(project_ids)))

    session.exec(delete(TeamMember).where(TeamMember.team_id == team_id))
    session.exec(delete(TeamInvite).where(TeamInvite.team_id == team_id))
    session.exec(delete(UserDefaultView).where(UserDefaultView.team_id == team_id))
    session.exec(delete(AutomationRun).where(AutomationRun.team_id == team_id))
    session.exec(delete(AutomationRule).where(AutomationRule.team_id == team_id))
    session.exec(delete(SavedView).where(SavedView.team_id == team_id))
    session.exec(delete(Repository).where(Repository.team_id == team_id))
    session.exec(delete(OutboundWebhook).where(OutboundWebhook.team_id == team_id))
    session.exec(delete(TicketTemplate).where(TicketTemplate.team_id == team_id))

    field_ids = session.exec(
        select(CustomField.id).where(CustomField.team_id == team_id)
    ).all()
    if field_ids:
        session.exec(
            delete(CustomFieldValue).where(CustomFieldValue.field_id.in_(field_ids))
        )
    session.exec(delete(CustomField).where(CustomField.team_id == team_id))
    session.exec(delete(Label).where(Label.team_id == team_id))
    session.exec(delete(WorkflowStatus).where(WorkflowStatus.team_id == team_id))
    session.exec(delete(Project).where(Project.team_id == team_id))
    session.exec(delete(Sprint).where(Sprint.team_id == team_id))

    session.flush()
    session.delete(team)
    session.commit()


def update_team(
    session: Session, current_user: User, team_id: int, payload: TeamUpdate
) -> Team:
    team = get_team_or_404(team_id, session)
    other_changes = bool(payload.model_dump(exclude_unset=True).keys() - {"archived"})

    if team.archived:
        if payload.archived is not False or other_changes:
            raise api_error(
                status_code=403,
                code=ErrorCode.team_read_only,
                detail="This team is archived, so it can only be restored",
            )
        if not current_user.is_site_admin:
            require_team_admin(team_id, current_user, session)
    elif not current_user.is_site_admin:
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
    if payload.any_member_may_delete is not None:
        team.any_member_may_delete = payload.any_member_may_delete
    if payload.guests_may_comment is not None:
        team.guests_may_comment = payload.guests_may_comment
    if payload.wip_limits_hard is not None:
        team.wip_limits_hard = payload.wip_limits_hard
    if payload.wip_counts_subtickets is not None:
        team.wip_counts_subtickets = payload.wip_counts_subtickets
    if payload.archived is not None:
        team.archived = payload.archived

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

    epics = outside.epics_by_member(
        session, team_id, [user.id for _, user in rows if user.is_external]
    )
    return [
        _member_read(membership, user, epics.get(user.id, []))
        for membership, user in rows
    ]


def _member_read(
    membership: TeamMember, user: User, epics: list[Project]
) -> TeamMemberRead:
    return TeamMemberRead(
        user=UserPublic.model_validate(user),
        role=membership.role,
        joined_at=membership.joined_at,
        epics=[EpicRef.model_validate(epic) for epic in epics],
    )


def _refuse_epics_for_insiders(user: User) -> None:
    raise api_error(
        status_code=400,
        code=ErrorCode.epics_only_for_external,
        detail=f"{user.full_name} is inside the organisation and sees every "
        "epic on the team",
    )


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

    # Somebody from outside joins as a guest, seeing the epics chosen (#243).
    outside.refuse_unless_guest(user, payload.role)
    if payload.epic_ids and not user.is_external:
        _refuse_epics_for_insiders(user)
    epic_ids = outside.check_epics(session, team_id, payload.epic_ids)

    membership = TeamMember(team_id=team_id, user_id=user.id, role=payload.role)
    session.add(membership)
    if user.is_external:
        outside.set_epics(session, team_id, user.id, epic_ids)
    session.commit()
    session.refresh(membership)

    return _member_read(membership, user, outside.epics_of(session, user.id, team_id))


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
    user = session.get(User, member_user_id)
    role = payload.role if payload.role is not None else membership.role

    # Somebody from outside stays a guest, and is given epics (#243); nobody
    # else is, since they see every epic already.
    outside.refuse_unless_guest(user, role)
    if payload.epic_ids is not None and not user.is_external:
        _refuse_epics_for_insiders(user)
    epic_ids = (
        outside.check_epics(session, team_id, payload.epic_ids)
        if payload.epic_ids is not None
        else None
    )

    demoting_an_admin = membership.role == TeamRole.admin and role != TeamRole.admin
    if demoting_an_admin and _active_admin_count(session, team_id) <= 1:
        raise api_error(
            status_code=409,
            code=ErrorCode.last_team_admin,
            detail="A team needs at least one admin",
        )
    # A guest holds no tickets (#316), so becoming one hands on the open ones,
    # the way leaving does.
    becoming_a_guest = role == TeamRole.guest and membership.role != TeamRole.guest
    if becoming_a_guest:
        _check_handover(session, team_id, member_user_id, payload.reassign_to)

    membership.role = role
    session.add(membership)
    if epic_ids is not None:
        outside.set_epics(session, team_id, member_user_id, epic_ids)
    if becoming_a_guest:
        session.flush()
        _hand_over_open_tickets(
            session, current_user, team_id, member_user_id, payload.reassign_to
        )
    session.commit()
    session.refresh(membership)

    return _member_read(
        membership, user, outside.epics_of(session, member_user_id, team_id)
    )


def remove_team_member(
    session: Session,
    current_user: User,
    team_id: int,
    member_user_id: int,
    reassign_to: Optional[int] = None,
) -> None:
    """Remove someone from a team, or leave it yourself.

    One function for both because they are the same row and the same guards --
    only who is allowed to ask differs.

    Their open tickets go to `reassign_to`, or to nobody (#316). Left with
    them, the tickets would count in the workload of somebody who can no
    longer open them. Done and cancelled tickets keep their name: there it
    records who did the work, which is what anybody still wants to know.
    """
    team = get_team_or_404(team_id, session)

    leaving = member_user_id == current_user.id
    if team.archived and not leaving:
        raise api_error(
            status_code=403,
            code=ErrorCode.team_read_only,
            detail="This team is archived, so it can only be restored",
        )
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
    _check_handover(session, team_id, member_user_id, reassign_to)

    # Gone before the tickets are handed on, so a rule that fires on the
    # change cannot give one straight back to them. The epics somebody from
    # outside was given here go with the membership (#243).
    session.delete(membership)
    outside.forget_team(session, team_id, member_user_id)
    session.flush()
    _hand_over_open_tickets(session, current_user, team_id, member_user_id, reassign_to)
    session.commit()


def _check_handover(
    session: Session, team_id: int, member_user_id: int, reassign_to: Optional[int]
) -> None:
    """Refuse a handover before anything changes: to the person giving the
    tickets up, or to somebody who could not hold them."""
    if reassign_to == member_user_id:
        raise api_error(
            status_code=400,
            code=ErrorCode.user_not_on_team,
            detail="Their tickets have to go to somebody else on the team.",
        )
    require_assignable(team_id, reassign_to, session)


def _hand_over_open_tickets(
    session: Session,
    current_user: User,
    team_id: int,
    member_user_id: int,
    reassign_to: Optional[int],
) -> None:
    # Imported here: the ticket service depends on this module for its
    # membership guards.
    from lib_softtrack.tickets import hand_over_open_tickets

    hand_over_open_tickets(session, current_user, team_id, member_user_id, reassign_to)
