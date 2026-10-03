"""Running automation rules: the engine the rest of the tracker calls into.

The ticket, comment, sprint and repository-integration services call the `on_*`
hooks below and know nothing else about automation -- the same arrangement as `history.py` and
`notifications.py`, and for the same reason. "What fires, and what it does"
is one policy, and it is only correct if it lives in one place.

`lib_softtrack/automations.py` is the other half: writing rules down and
reading the log. This half never validates anything, because everything a
rule names was checked against its team on the day it was saved.

Four properties everything here is built to keep:

**A rule's own changes never fire another rule.** Two things make that true,
and neither is a depth counter. The engine writes to the ticket row directly
rather than going back through `update_ticket`, so no action can re-enter the
service layer; and each hook decides which of its triggers happened *before*
dispatching any of them, so a rule that assigns a ticket cannot set off the
assignment rules from inside the creation ones. Two rules whose actions feed
each other would otherwise loop until the request timed out, and a team would
discover it by watching a ticket's history fill up. One event is one pass over
the rules.

**Nothing is attributed to a person who did not do it.** The actor on the
history rows, the notifications and the comments an automation writes is null,
not whoever tripped the rule. Someone dragging a card should not find their
name on four changes they did not make.

**Only real changes are recorded.** A rule setting a status to the one the
ticket is already in did nothing, and a run-log row claiming otherwise is the
log lying on the one occasion somebody is reading it closely.

**Every rule sees the same ticket.** Which rules match is decided before any of
them run, so a rule cannot be set off by the rule above it in the list. They
are then applied in the order they were written, and the last one to set a
field wins -- two rules disagreeing about a status is a thing a team can do
and will occasionally mean, and what it must not be is unpredictable.
"""

from datetime import datetime, timezone
from typing import Iterable, Optional

from sqlmodel import Session, select

from lib_softtrack import automations as automations_service
from lib_softtrack import history, notifications as notifications_service, outbound, wip
from lib_softtrack.automations import MAX_RUNS_PER_TEAM
from lib_softtrack.models.automations import RuleActions
from lib_softtrack.tables import (
    AutomationRule,
    AutomationRun,
    AutomationTrigger,
    Comment,
    Sprint,
    Ticket,
    TicketLabelLink,
    Label,
    User,
    WorkflowStatus,
)
from lib_softtrack.teams import can_be_assigned

#: The ticket fields whose movement can set a rule off. Snapshotted before an
#: update the way `history.snapshot` and `notifications.snapshot` are -- three
#: lists of the same shape over the same row, kept separate because they are
#: three different questions. History is "what can be charted", notifications
#: are "what somebody wants to be told", and this is "what a rule can watch
#: for". They happen to overlap today; merging them would mean adding a field
#: to one of those answers by adding it to all three.
TRIGGERING_FIELDS = ("status_id", "assignee_id")


def snapshot(ticket: Ticket) -> dict[str, object]:
    """The triggering fields as they are now, for comparison after an update."""
    return {field: getattr(ticket, field) for field in TRIGGERING_FIELDS}


# ---------------------------------------------------------------------------
# Hooks
# ---------------------------------------------------------------------------


def on_ticket_created(session: Session, ticket: Ticket, actor: Optional[User]) -> None:
    """A new ticket. Fires `ticket_created`, and `ticket_assigned` if it has one.

    Both, rather than one or the other: filing a ticket already assigned is
    two things that happened, and a team with a rule about each means both of
    them.

    Which of them happened is read *before* either dispatch. Otherwise an
    `ticket_created` rule that assigns the ticket would go on to set off the
    `ticket_assigned` rules -- one rule firing another through the one door
    this module would have left open.
    """
    arrived_assigned = ticket.assignee_id is not None

    _dispatch(
        session, ticket.team_id, AutomationTrigger.ticket_created, [ticket], actor
    )
    if arrived_assigned:
        _dispatch(
            session, ticket.team_id, AutomationTrigger.ticket_assigned, [ticket], actor
        )


def on_ticket_updated(
    session: Session, ticket: Ticket, before: dict[str, object], actor: Optional[User]
) -> None:
    """A ticket changed. Fires on the fields that actually moved.

    `before` is a `snapshot` taken before the update was applied. Comparing
    values rather than trusting the payload matters here for the same reason
    it does in `history.py`: a PATCH setting the status to what it already was
    is not a status change, and a rule firing on it would act on a ticket
    nobody touched.

    Both questions are asked before either dispatch, for the same reason
    `on_ticket_created` reads its own: a `status_changed` rule that assigns the
    ticket must not go on to set off the `ticket_assigned` rules.
    """
    status_moved = ticket.status_id != before.get("status_id")
    # Being *un*assigned is not this trigger. It is a real event, but there is
    # nobody to act on and no rule anybody has wanted to write about it.
    newly_assigned = (
        ticket.assignee_id != before.get("assignee_id")
        and ticket.assignee_id is not None
    )

    if status_moved:
        _dispatch(
            session, ticket.team_id, AutomationTrigger.status_changed, [ticket], actor
        )
    if newly_assigned:
        _dispatch(
            session, ticket.team_id, AutomationTrigger.ticket_assigned, [ticket], actor
        )


def on_comment_created(session: Session, ticket: Ticket, actor: Optional[User]) -> None:
    _dispatch(session, ticket.team_id, AutomationTrigger.comment_added, [ticket], actor)


def on_sprint_completed(
    session: Session, sprint: Sprint, tickets: list[Ticket], actor: Optional[User]
) -> None:
    """A sprint finished. Fires once per ticket that was in it.

    `tickets` is the membership as it stood before the carry-over, and the
    hook runs after it -- so a rule can see which tickets came out of the
    sprint unfinished and act on all of them, not only the ones that stayed.
    """
    _dispatch(
        session, sprint.team_id, AutomationTrigger.sprint_completed, tickets, actor
    )


def on_code_event(session: Session, ticket: Ticket, trigger: AutomationTrigger) -> None:
    """A branch or pull request in a connected repository named this ticket.

    No actor, and not because one was hard to find: the person who pushed is a
    GitHub login or a GitLab display name, and mapping that to a SoftTrack
    account is a guess. A wrong guess would put somebody's name on a status
    change they did not make, which is the one thing this module refuses to
    do. `AutomationRun.actor_id` is nullable for exactly this.

    Firing on transitions rather than on deliveries is the caller's job -- see
    `integrations._upsert`. Webhooks are at-least-once, and both providers have
    a "redeliver" button.
    """
    _dispatch(session, ticket.team_id, trigger, [ticket], None)


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------


def _dispatch(
    session: Session,
    team_id: int,
    trigger: AutomationTrigger,
    tickets: Iterable[Ticket],
    actor: Optional[User],
) -> None:
    """Run every enabled rule on this trigger against these tickets.

    Rows are added to whatever transaction is open rather than committed here.
    The change a rule makes and the change that set it off belong to the same
    request, and half of them landing would be worse than neither.
    """
    rules = session.exec(
        select(AutomationRule)
        .where(
            AutomationRule.team_id == team_id,
            AutomationRule.trigger == trigger,
            AutomationRule.is_enabled == True,  # noqa: E712 -- SQL comparison
        )
        .order_by(AutomationRule.id)
    ).all()
    if not rules:
        return

    recorded = False
    for ticket in tickets:
        # Which rules match is decided before any of them run, so every rule
        # reads the ticket as the *event* left it rather than as the rule
        # before it did. Without that, a rule whose condition another rule's
        # action happens to satisfy fires in the same pass -- which is the
        # loop this module exists to not have, arriving through the side door.
        # Order still decides who wins when two rules set the same field.
        matched = [rule for rule in rules if _matches(session, rule, ticket)]

        for rule in matched:
            summary = _apply(session, rule, ticket, actor)
            if not summary:
                # Matched, but every action was already true of the ticket.
                continue
            session.add(
                AutomationRun(
                    team_id=team_id,
                    rule_id=rule.id,
                    rule_name=rule.name,
                    trigger=trigger,
                    ticket_id=ticket.id,
                    actor_id=actor.id if actor else None,
                    summary="\n".join(summary),
                )
            )
            recorded = True

    if recorded:
        _prune(session, team_id)


def _prune(session: Session, team_id: int) -> None:
    """Keep the team's log to its most recent `MAX_RUNS_PER_TEAM` rows.

    Here rather than in a background job because this is the only code that
    ever makes the table bigger, so it is the only code that has to care. One
    indexed DELETE on a path that is already writing several rows.
    """
    # The rows just added have no ids until they are flushed, and pruning
    # around them would drop older rows to make room for rows the database
    # cannot see yet.
    session.flush()

    keep = (
        select(AutomationRun.id)
        .where(AutomationRun.team_id == team_id)
        .order_by(AutomationRun.id.desc())
        .limit(MAX_RUNS_PER_TEAM)
    )
    for run in session.exec(
        select(AutomationRun).where(
            AutomationRun.team_id == team_id,
            AutomationRun.id.not_in(keep),
        )
    ).all():
        session.delete(run)


# ---------------------------------------------------------------------------
# Conditions
# ---------------------------------------------------------------------------


def _matches(session: Session, rule: AutomationRule, ticket: Ticket) -> bool:
    """Every condition the rule states, ANDed. Null states nothing."""
    if rule.if_status_id is not None and ticket.status_id != rule.if_status_id:
        return False
    if rule.if_priority is not None and ticket.priority != rule.if_priority:
        return False
    if rule.if_type is not None and ticket.type != rule.if_type:
        return False
    if rule.if_project_id is not None and ticket.project_id != rule.if_project_id:
        return False
    if rule.if_unassigned and ticket.assignee_id is not None:
        return False
    if rule.if_assignee_id is not None and ticket.assignee_id != rule.if_assignee_id:
        return False
    if rule.if_label_id is not None and not _has_label(
        session, ticket.id, rule.if_label_id
    ):
        return False
    return True


def _has_label(session: Session, ticket_id: int, label_id: int) -> bool:
    return session.get(TicketLabelLink, (ticket_id, label_id)) is not None


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------


def _apply(
    session: Session, rule: AutomationRule, ticket: Ticket, actor: Optional[User]
) -> list[str]:
    """Do what the rule says, and report what actually changed.

    The returned lines are the run log's summary, written now rather than
    derived when the log is read: a summary rebuilt from the rule's current
    columns would describe the rule as it is today, which is exactly the
    question the log is not being asked.

    An empty list means the rule matched and had nothing left to do.
    """
    actions = automations_service.actions_of(rule)
    history_before = history.snapshot(ticket)
    notify_before = notifications_service.snapshot(ticket)
    hook_before = outbound.snapshot(ticket)

    lines: list[str] = []
    touched_ticket = False

    if actions.set_status_id is not None and ticket.status_id != actions.set_status_id:
        status = session.get(WorkflowStatus, actions.set_status_id)
        # A rule follows the team's WIP limits like anybody (#270). It skips
        # the move rather than failing whatever set it off, and says so in
        # the run log, as it does for an assignee who cannot hold the ticket.
        full = wip.room(
            session,
            ticket.team_id,
            actions.set_status_id,
            [(ticket.status_id, ticket.parent_id)],
        )
        if full is not None:
            lines.append(f"Did not move it to {status.name}: {full}")
        else:
            ticket.status_id = actions.set_status_id
            lines.append(f"Set status to {status.name}")
            touched_ticket = True

    if actions.set_priority is not None and ticket.priority != actions.set_priority:
        ticket.priority = actions.set_priority
        lines.append(f"Set priority to {actions.set_priority.value.replace('_', ' ')}")
        touched_ticket = True

    if actions.set_type is not None and ticket.type != actions.set_type:
        ticket.type = actions.set_type
        lines.append(f"Set type to {actions.set_type.value}")
        touched_ticket = True

    if (
        actions.set_assignee_id is not None
        and ticket.assignee_id != actions.set_assignee_id
    ):
        assignee = session.get(User, actions.set_assignee_id)
        # Checked again now, not only when the rule was saved: the person it
        # names may have left the team since, or become a guest (#316).
        if can_be_assigned(ticket.team_id, assignee.id, session):
            ticket.assignee_id = actions.set_assignee_id
            lines.append(f"Assigned to {assignee.full_name}")
            touched_ticket = True
        else:
            lines.append(
                f"Did not assign {assignee.full_name}, "
                "who can no longer hold this team's tickets"
            )

    if actions.add_label_id is not None and not _has_label(
        session, ticket.id, actions.add_label_id
    ):
        label = session.get(Label, actions.add_label_id)
        session.add(TicketLabelLink(ticket_id=ticket.id, label_id=actions.add_label_id))
        lines.append(f"Added the label {label.name}")
        touched_ticket = True

    sprint = _target_sprint(session, ticket.team_id, actions)
    if sprint is not None and ticket.sprint_id != sprint.id:
        ticket.sprint_id = sprint.id
        lines.append(f"Moved to {sprint.name or f'Sprint {sprint.number}'}")
        touched_ticket = True

    body = (actions.comment_body or "").strip()
    if body:
        # No "did this already" check: a comment is an event, not a state, and
        # a rule that says something once an hour is saying it once an hour on
        # purpose.
        comment = Comment(ticket_id=ticket.id, author_id=None, body=body)
        session.add(comment)
        session.flush()
        notifications_service.on_comment_created(session, ticket, comment, actor=None)
        lines.append("Posted a comment")

    if touched_ticket:
        ticket.updated_at = datetime.now(timezone.utc)
        session.add(ticket)
        # Actor null on both: nobody did this. TicketEvent.actor_id and
        # Notification.actor_id are nullable for exactly this case.
        history.record_changes(session, ticket, history_before, actor=None)
        notifications_service.on_ticket_updated(
            session, ticket, notify_before, actor=None
        )
        outbound.ticket_changed(session, ticket, hook_before, actor=None)

    return lines


def _target_sprint(
    session: Session, team_id: int, actions: RuleActions
) -> Optional[Sprint]:
    """The sprint this rule moves a ticket into, if there is one to move it to.

    `move_to_active_sprint` with no sprint running is not an error and not a
    skipped rule -- it is a rule whose other actions still apply and whose
    sprint action has nowhere to point this week. Silently doing nothing is the
    only reading that does not either lose the rest of the rule or invent a
    sprint.
    """
    if actions.set_sprint_id is not None:
        return session.get(Sprint, actions.set_sprint_id)
    if not actions.move_to_active_sprint:
        return None

    # Imported here rather than at module scope: `sprints.py` calls this module
    # on completion, and at module level that is an import cycle.
    from lib_softtrack.sprints import active_sprint

    return active_sprint(session, team_id)
