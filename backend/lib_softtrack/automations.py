"""Automation rules: writing them down, and reading what they did.

Two halves, and they are deliberately in different modules. This one is the
service the settings page talks to -- create, edit, enable, delete, and read
the run log. `lib_softtrack/rules.py` is the engine the issue, comment and
cycle services call when something happens. Splitting them the way
`history.py` and `notifications.py` are split from `issues.py` keeps the hot
path -- "an issue changed; is there a rule about that" -- free of anything to
do with validating a form.

The rule that shapes most of this module: **a rule may only name things that
belong to its own team.** A rule pointing at another team's status or label
would either match nothing forever or move work off the board, and it would
look like a bug in automation rather than a bad reference. It is checked once
on write, in `_validate`, rather than on every event.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlmodel import Session, func, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.automations import (
    AutomationRuleCreate,
    AutomationRuleRead,
    AutomationRuleUpdate,
    AutomationRunRead,
    RuleActions,
    RuleConditions,
)
from lib_softtrack.models.page import DEFAULT_LIMIT, Page
from lib_softtrack.tables import (
    AutomationRule,
    AutomationRun,
    Cycle,
    Issue,
    Label,
    Project,
    Team,
    TeamMember,
    User,
    WorkflowStatus,
)
from lib_softtrack.teams import (
    get_team_or_404,
    require_team_admin,
    require_team_member,
)

#: How many runs a team's log keeps. The log is written to on every automated
#: change and read roughly never, so it is the one table here that grows
#: without anybody deciding to grow it. Five hundred is far more than anyone
#: scrolls and small enough that the table stays a footnote; pruning happens
#: in `rules.py` as the runs are recorded.
MAX_RUNS_PER_TEAM = 500

#: The condition columns, and the action columns. Named once so that reading a
#: rule, writing one and clearing a reference out of one cannot drift apart.
_CONDITION_FIELDS = (
    "if_status_id",
    "if_priority",
    "if_label_id",
    "if_project_id",
    "if_assignee_id",
    "if_unassigned",
)
_ACTION_FIELDS = (
    "set_status_id",
    "set_priority",
    "set_assignee_id",
    "add_label_id",
    "set_cycle_id",
    "move_to_active_cycle",
    "comment_body",
)


def conditions_of(rule: AutomationRule) -> RuleConditions:
    return RuleConditions.model_construct(
        **{field: getattr(rule, field) for field in _CONDITION_FIELDS}
    )


def actions_of(rule: AutomationRule) -> RuleActions:
    return RuleActions.model_construct(
        **{field: getattr(rule, field) for field in _ACTION_FIELDS}
    )


def _to_read(rule: AutomationRule, author: User) -> AutomationRuleRead:
    return AutomationRuleRead(
        id=rule.id,
        team_id=rule.team_id,
        name=rule.name,
        trigger=rule.trigger,
        is_enabled=rule.is_enabled,
        conditions=conditions_of(rule),
        actions=actions_of(rule),
        created_by=UserPublic.model_validate(author),
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _belongs_to_team(session: Session, table, row_id: Optional[int], team_id: int):
    """A row of `table` with this id, on this team, or a 400 saying so."""
    if row_id is None:
        return None
    row = session.get(table, row_id)
    if row is None or row.team_id != team_id:
        raise HTTPException(
            status_code=400,
            detail=f"No such {table.__name__.lower().removeprefix('workflow')} "
            "on this team",
        )
    return row


def _is_member(session: Session, team_id: int, user_id: Optional[int]) -> bool:
    if user_id is None:
        return True
    return (
        session.exec(
            select(TeamMember).where(
                TeamMember.team_id == team_id, TeamMember.user_id == user_id
            )
        ).first()
        is not None
    )


def _validate(
    session: Session, team_id: int, conditions: RuleConditions, actions: RuleActions
) -> None:
    """Reject a rule naming anything outside its team, or nobody on it."""
    _belongs_to_team(session, WorkflowStatus, conditions.if_status_id, team_id)
    _belongs_to_team(session, Label, conditions.if_label_id, team_id)
    _belongs_to_team(session, Project, conditions.if_project_id, team_id)
    _belongs_to_team(session, WorkflowStatus, actions.set_status_id, team_id)
    _belongs_to_team(session, Label, actions.add_label_id, team_id)

    cycle = _belongs_to_team(session, Cycle, actions.set_cycle_id, team_id)
    if cycle is not None and cycle.state.value == "completed":
        # Not a foreign key problem -- a meaning problem. A completed cycle's
        # numbers are history everywhere else in SoftTrack, and a rule that
        # kept dropping work into it would rewrite a report every time it
        # fired.
        raise HTTPException(
            status_code=400,
            detail="That cycle is completed; its numbers are history. "
            "Use the active cycle instead.",
        )

    for user_id in (conditions.if_assignee_id, actions.set_assignee_id):
        if not _is_member(session, team_id, user_id):
            raise HTTPException(
                status_code=400, detail="That person is not on this team"
            )


def _assert_name_free(
    session: Session, team_id: int, name: str, except_id: Optional[int] = None
) -> None:
    statement = select(AutomationRule).where(
        AutomationRule.team_id == team_id, AutomationRule.name == name
    )
    if except_id is not None:
        statement = statement.where(AutomationRule.id != except_id)
    if session.exec(statement).first():
        raise HTTPException(
            status_code=400, detail="This team already has a rule with that name"
        )


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------


def get_rule_or_404(
    session: Session, current_user: User, rule_id: int
) -> AutomationRule:
    rule = session.get(AutomationRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    require_team_member(rule.team_id, current_user, session)
    return rule


def list_rules(
    session: Session, current_user: User, team_id: int
) -> list[AutomationRuleRead]:
    """Every rule on the team, in the order they run.

    Not paginated, and not filtered to the enabled ones: a team with more
    rules than fit in one response has a different problem, and a disabled
    rule that vanished from the list would be very hard to switch back on.
    """
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    rows = session.exec(
        select(AutomationRule, User)
        .join(User, User.id == AutomationRule.created_by_id)
        .where(AutomationRule.team_id == team_id)
        # By id, which is the order they were written and the order they run.
        # See `rules.py` -- two rules setting the same field is last-wins, and
        # a list sorted by name would hide which one that is.
        .order_by(AutomationRule.id)
    ).all()
    return [_to_read(rule, author) for rule, author in rows]


def create_rule(
    session: Session, current_user: User, team_id: int, payload: AutomationRuleCreate
) -> AutomationRuleRead:
    get_team_or_404(team_id, session)
    # Admin-only, like statuses and unlike labels: a rule acts on everybody's
    # issues without asking, which is a bigger thing to hand out than a
    # colour on a chip.
    require_team_admin(team_id, current_user, session)

    name = payload.name.strip()
    _assert_name_free(session, team_id, name)
    _validate(session, team_id, payload.conditions, payload.actions)

    rule = AutomationRule(
        team_id=team_id,
        name=name,
        trigger=payload.trigger,
        is_enabled=payload.is_enabled,
        created_by_id=current_user.id,
        **payload.conditions.model_dump(),
        **payload.actions.model_dump(),
    )
    session.add(rule)
    session.commit()
    session.refresh(rule)
    return _to_read(rule, current_user)


def update_rule(
    session: Session, current_user: User, rule_id: int, payload: AutomationRuleUpdate
) -> AutomationRuleRead:
    rule = get_rule_or_404(session, current_user, rule_id)
    require_team_admin(rule.team_id, current_user, session)

    if payload.name is not None:
        name = payload.name.strip()
        _assert_name_free(session, rule.team_id, name, except_id=rule.id)
        rule.name = name
    if payload.trigger is not None:
        rule.trigger = payload.trigger
    if payload.is_enabled is not None:
        rule.is_enabled = payload.is_enabled

    # Validated together even when only one arrives, because the checks below
    # are about the pair -- an action pointing at a status, a condition
    # pointing at a person -- and half a rule is not something to check.
    conditions = payload.conditions or conditions_of(rule)
    actions = payload.actions or actions_of(rule)
    if payload.conditions is not None or payload.actions is not None:
        _validate(session, rule.team_id, conditions, actions)
        for field, value in {**conditions.model_dump(), **actions.model_dump()}.items():
            setattr(rule, field, value)

    rule.updated_at = datetime.now(timezone.utc)
    session.add(rule)
    session.commit()
    session.refresh(rule)
    return _to_read(rule, session.get(User, rule.created_by_id))


def delete_rule(session: Session, current_user: User, rule_id: int) -> None:
    """Remove a rule, keeping what it did.

    Its runs stay and lose their link to it -- see AutomationRun. Somebody
    deleting a rule for having done something surprising is precisely the
    person who will want to read the log of it afterwards.
    """
    rule = get_rule_or_404(session, current_user, rule_id)
    require_team_admin(rule.team_id, current_user, session)

    for run in session.exec(
        select(AutomationRun).where(AutomationRun.rule_id == rule.id)
    ).all():
        run.rule_id = None
        session.add(run)
    session.flush()

    session.delete(rule)
    session.commit()


# ---------------------------------------------------------------------------
# The run log
# ---------------------------------------------------------------------------


def list_runs(
    session: Session,
    current_user: User,
    team_id: int,
    rule_id: Optional[int] = None,
    issue_id: Optional[int] = None,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> Page[AutomationRunRead]:
    """What the team's rules have done, newest first.

    Readable by any member, not just admins. The log answers "why did my issue
    move", and the person asking is the one it moved out from under.
    """
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    filters = [AutomationRun.team_id == team_id]
    if rule_id is not None:
        filters.append(AutomationRun.rule_id == rule_id)
    if issue_id is not None:
        filters.append(AutomationRun.issue_id == issue_id)

    total = session.exec(
        select(func.count()).select_from(AutomationRun).where(*filters)
    ).one()

    # One join for the issue rather than a lookup per row: the log is read a
    # page at a time and every row names an issue.
    rows = session.exec(
        select(AutomationRun, Issue, Team)
        .join(Issue, Issue.id == AutomationRun.issue_id)
        .join(Team, Team.id == AutomationRun.team_id)
        .where(*filters)
        .order_by(AutomationRun.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()

    actors = {
        user.id: user
        for user in session.exec(
            select(User).where(
                User.id.in_({run.actor_id for run, _, _ in rows if run.actor_id})
            )
        ).all()
    }

    return Page(
        items=[
            AutomationRunRead(
                id=run.id,
                rule_id=run.rule_id,
                rule_name=run.rule_name,
                trigger=run.trigger,
                issue_id=issue.id,
                issue_identifier=f"{team.key}-{issue.number}",
                issue_title=issue.title,
                actor=(
                    UserPublic.model_validate(actors[run.actor_id])
                    if run.actor_id in actors
                    else None
                ),
                summary=run.summary,
                created_at=run.created_at,
            )
            for run, issue, team in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


def delete_runs_for_issue(session: Session, issue_id: int) -> None:
    """Drop the log rows for an issue being deleted.

    They hold a foreign key to it, and there is nothing to keep: a log entry
    about an issue that no longer exists is a link to a 404. Same call and
    same reasoning as `notifications.delete_for_issue`.
    """
    for run in session.exec(
        select(AutomationRun).where(AutomationRun.issue_id == issue_id)
    ).all():
        session.delete(run)


# ---------------------------------------------------------------------------
# Keeping rules honest when what they name goes away
# ---------------------------------------------------------------------------


def move_status(session: Session, status_id: int, target_id: int) -> None:
    """Point rules at the column a deleted status's issues were merged into.

    Called from the status service, which already asks where the issues go.
    Sending the rules after them is the reading that keeps meaning what the
    team meant: the column was merged, not the intent.

    Clearing the reference instead would be actively wrong for a *condition* --
    a null condition means "no opinion", so a rule that fired on issues in one
    column would quietly start firing on all of them.
    """
    for rule in session.exec(
        select(AutomationRule).where(AutomationRule.if_status_id == status_id)
    ).all():
        rule.if_status_id = target_id
        session.add(rule)
    for rule in session.exec(
        select(AutomationRule).where(AutomationRule.set_status_id == status_id)
    ).all():
        rule.set_status_id = target_id
        session.add(rule)
    session.flush()


def clear_cycle(session: Session, cycle_id: int) -> None:
    """Disarm rules that moved issues into a cycle being deleted.

    Unlike a status there is nowhere to send them -- a deleted cycle's issues
    go to the backlog, and "move it to the backlog" is not what the rule said.
    So the reference goes and the rule is switched off rather than left
    enabled doing less than it claims. It shows up disabled in the settings
    list, which is where somebody can decide what it should say instead.
    """
    for rule in session.exec(
        select(AutomationRule).where(AutomationRule.set_cycle_id == cycle_id)
    ).all():
        rule.set_cycle_id = None
        rule.is_enabled = False
        session.add(rule)
    session.flush()
