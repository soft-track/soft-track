"""Ticket services, including the assembly of the denormalised TicketRead payload."""

from collections import defaultdict
from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone
from typing import NamedTuple, Optional, Union

from fastapi import HTTPException
from sqlalchemy import case, func, or_
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack import attachments as attachments_service
from lib_softtrack import custom_fields as custom_fields_service
from lib_softtrack import outbound, outside
from lib_softtrack.models.tickets import (
    TicketBulkChanges,
    TicketBulkUpdate,
    TicketMove,
    TicketCreate,
    TicketRead,
    TicketUpdate,
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
    Sprint,
    DueFilter,
    Ticket,
    TicketEvent,
    TicketLabelLink,
    TicketLink,
    TicketPriority,
    TicketSort,
    TicketType,
    Label,
    Project,
    SortDirection,
    Team,
    User,
    WebhookEvent,
    WorkflowStatus,
)
from lib_softtrack.sprints import display_name as sprint_display_name
from lib_softtrack.ranks import neighbour_or_404, rank_between, rank_order, top_rank
from lib_softtrack.statuses import (
    RESOLVED,
    default_status,
    in_category,
    resolve_for_team,
)
from lib_softtrack.subtickets import child_progress, detach_children, validate_parent
from lib_softtrack.teams import (
    get_team_or_404,
    require_assignable,
    require_team_member,
)
from lib_softtrack.trash import INCLUDE_TRASHED
from lib_utils.errors import ErrorCode, api_error


def _parent_ref(ticket: Ticket, session: Session) -> Optional[ParentRef]:
    """The breadcrumb back to a sub-ticket's parent, if it has one."""
    if ticket.parent_id is None:
        return None
    parent = session.get(Ticket, ticket.parent_id)
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


def ticket_to_read(ticket: Ticket, session: Session) -> TicketRead:
    """Expand a Ticket row into the shape the API returns."""
    done, total = child_progress(session, [ticket.id]).get(ticket.id, (0, 0))
    team = session.get(Team, ticket.team_id)
    assignee = session.get(User, ticket.assignee_id) if ticket.assignee_id else None
    creator = session.get(User, ticket.creator_id)
    label_links = session.exec(
        select(TicketLabelLink).where(TicketLabelLink.ticket_id == ticket.id)
    ).all()
    labels = [session.get(Label, link.label_id) for link in label_links]
    custom_fields = custom_fields_service.read_values(session, [ticket.id])

    return TicketRead(
        id=ticket.id,
        team_id=ticket.team_id,
        team_key=team.key,
        project_id=ticket.project_id,
        number=ticket.number,
        identifier=f"{team.key}-{ticket.number}",
        title=ticket.title,
        description=ticket.description,
        status=StatusRead.model_validate(session.get(WorkflowStatus, ticket.status_id)),
        priority=ticket.priority,
        type=ticket.type,
        rank=ticket.rank,
        assignee=UserPublic.model_validate(assignee) if assignee else None,
        estimate=ticket.estimate,
        blocked_by_count=open_blocker_counts(session, [ticket.id]).get(ticket.id, 0),
        sprint_id=ticket.sprint_id,
        due_date=ticket.due_date,
        external_key=ticket.external_key,
        parent=_parent_ref(ticket, session),
        completed_child_count=done,
        child_count=total,
        creator=UserPublic.model_validate(creator),
        labels=[label for label in labels if label is not None],
        custom_fields=custom_fields.get(ticket.id, {}),
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
    )


def _expand_tickets(tickets: list[Ticket], session: Session) -> list[TicketRead]:
    """Build TicketRead for a page of tickets with a fixed number of queries.

    `ticket_to_read` is fine for one ticket but costs a query per ticket for its
    label links, so a page of 50 cost ~58 queries. Loading labels, users and
    teams in one query each makes the cost constant in the page size.

    (The identity map already absorbed the repeated user and team lookups when
    a page shared an assignee -- the label links were the real N+1.)
    """
    if not tickets:
        return []

    ticket_ids = [ticket.id for ticket in tickets]

    labels_by_ticket: dict[int, list[Label]] = defaultdict(list)
    for ticket_id, label in session.exec(
        select(TicketLabelLink.ticket_id, Label)
        .join(Label, Label.id == TicketLabelLink.label_id)
        .where(TicketLabelLink.ticket_id.in_(ticket_ids))
    ).all():
        labels_by_ticket[ticket_id].append(label)

    user_ids = {ticket.creator_id for ticket in tickets}
    user_ids |= {ticket.assignee_id for ticket in tickets if ticket.assignee_id}
    users = {
        user.id: user
        for user in session.exec(select(User).where(User.id.in_(user_ids))).all()
    }

    # One query each for blockers, sub-ticket progress and the parents on this
    # page, keeping the constant-query property this function exists for.
    blocker_counts = open_blocker_counts(session, ticket_ids)
    progress = child_progress(session, ticket_ids)
    parent_ids = {ticket.parent_id for ticket in tickets if ticket.parent_id}
    parents = {
        parent.id: parent
        for parent in session.exec(
            select(Ticket).where(Ticket.id.in_(parent_ids))
        ).all()
    }

    team_ids = {ticket.team_id for ticket in tickets}
    team_ids |= {parent.team_id for parent in parents.values()}
    teams = {
        team.id: team
        for team in session.exec(select(Team).where(Team.id.in_(team_ids))).all()
    }
    statuses = {
        status.id: status
        for status in session.exec(
            select(WorkflowStatus).where(
                WorkflowStatus.id.in_({ticket.status_id for ticket in tickets})
            )
        ).all()
    }
    custom_fields = custom_fields_service.read_values(session, ticket_ids)

    return [
        TicketRead(
            id=ticket.id,
            team_id=ticket.team_id,
            team_key=teams[ticket.team_id].key,
            project_id=ticket.project_id,
            number=ticket.number,
            identifier=f"{teams[ticket.team_id].key}-{ticket.number}",
            title=ticket.title,
            description=ticket.description,
            status=StatusRead.model_validate(statuses[ticket.status_id]),
            priority=ticket.priority,
            type=ticket.type,
            rank=ticket.rank,
            assignee=(
                UserPublic.model_validate(users[ticket.assignee_id])
                if ticket.assignee_id
                else None
            ),
            estimate=ticket.estimate,
            blocked_by_count=blocker_counts.get(ticket.id, 0),
            sprint_id=ticket.sprint_id,
            due_date=ticket.due_date,
            external_key=ticket.external_key,
            creator=UserPublic.model_validate(users[ticket.creator_id]),
            labels=labels_by_ticket.get(ticket.id, []),
            custom_fields=custom_fields.get(ticket.id, {}),
            parent=_parent_ref_from(parents.get(ticket.parent_id), teams),
            completed_child_count=progress.get(ticket.id, (0, 0))[0],
            child_count=progress.get(ticket.id, (0, 0))[1],
            created_at=ticket.created_at,
            updated_at=ticket.updated_at,
        )
        for ticket in tickets
    ]


def _parent_ref_from(parent: Optional[Ticket], teams: dict) -> Optional[ParentRef]:
    if parent is None or parent.team_id not in teams:
        return None
    return ParentRef(
        id=parent.id,
        team_key=teams[parent.team_id].key,
        number=parent.number,
        identifier=f"{teams[parent.team_id].key}-{parent.number}",
        title=parent.title,
    )


def set_labels(ticket_id: int, label_ids: list[int], session: Session) -> None:
    existing = session.exec(
        select(TicketLabelLink).where(TicketLabelLink.ticket_id == ticket_id)
    ).all()
    for link in existing:
        session.delete(link)
    session.flush()
    for label_id in label_ids:
        session.add(TicketLabelLink(ticket_id=ticket_id, label_id=label_id))


def get_ticket_or_404(session: Session, ticket_id: int) -> Ticket:
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise api_error(
            status_code=404, code=ErrorCode.ticket_not_found, detail="Ticket not found"
        )
    return ticket


def create_ticket(
    session: Session, current_user: User, team_id: int, payload: TicketCreate
) -> TicketRead:
    team = get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    _require_on_team(session, Project, payload.project_id, team_id, "project")
    require_assignable(team_id, payload.assignee_id, session)
    # Checked before anything is written, so a ticket refused for a missing
    # field does not use up a number -- or exist at all.
    field_changes = custom_fields_service.resolve(
        session, team_id, None, payload.type, payload.custom_fields
    )
    custom_fields_service.require_filled(session, team_id, payload.type, field_changes)

    number = team.next_ticket_number
    team.next_ticket_number = number + 1
    session.add(team)

    ticket = Ticket(
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
        sprint_id=payload.sprint_id,
        due_date=payload.due_date,
        # On top of its column, where a new card is looked for.
        rank=top_rank(session, team_id),
        creator_id=current_user.id,
    )

    if payload.parent_id is not None:
        ticket.parent_id = validate_parent(session, ticket, payload.parent_id).id

    session.add(ticket)
    session.commit()
    session.refresh(ticket)

    applied = custom_fields_service.write(
        session, ticket, field_changes, current_user, record=False
    )
    record_creation(session, ticket, current_user)
    notifications_service.on_ticket_created(
        session, ticket, current_user, named=applied.named
    )
    outbound.emit(
        session,
        ticket.team_id,
        WebhookEvent.ticket_created,
        lambda: {"ticket": ticket_to_read(ticket, session)},
        current_user,
    )
    session.commit()

    if payload.label_ids:
        set_labels(ticket.id, payload.label_ids, session)
        session.commit()

    # After the labels rather than with the notifications above: a rule can
    # match on a label, and one that fired before the labels were attached
    # would be reading a ticket that does not exist yet as far as the person
    # filing it is concerned.
    rules_service.on_ticket_created(session, ticket, current_user)
    session.commit()
    session.refresh(ticket)

    return ticket_to_read(ticket, session)


def list_tickets(
    session: Session,
    current_user: User,
    team_id: int,
    project_id: Optional[int] = None,
    status_id: Optional[int] = None,
    priority: Optional[TicketPriority] = None,
    assignee_id: Optional[int] = None,
    unassigned: bool = False,
    label_id: Optional[int] = None,
    parent_id: Optional[int] = None,
    sprint_id: Optional[int] = None,
    due: Optional[DueFilter] = None,
    today: Optional[date] = None,
    due_from: Optional[date] = None,
    due_to: Optional[date] = None,
    type: Optional[TicketType] = None,
    resolved: Optional[bool] = None,
    sort: TicketSort = TicketSort.created,
    direction: SortDirection = SortDirection.desc,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> Page[TicketRead]:
    """One page of a team's tickets, narrowed by any combination of filters.

    Every filter is applied here rather than in the browser. The list is
    paginated, so a client-side filter can only ever narrow the page it
    happens to hold -- "urgent tickets" would mean "urgent tickets among the
    fifty most recent", which is a different and much less useful thing, and
    silently so.
    """
    filters = _build_ticket_filters(
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
        sprint_id=sprint_id,
    )
    if type is not None:
        filters.append(Ticket.type == type)
    if resolved is not None:
        done_or_cancelled = in_category(*RESOLVED)
        filters.append(done_or_cancelled if resolved else ~done_or_cancelled)
    if due is not None:
        filters.append(_due_filter(due, today or datetime.now(timezone.utc).date()))
    # A date range, both ends inclusive (#105): the calendar asks for the days
    # its grid shows. Either end alone is an open range.
    if due_from is not None:
        filters.append(Ticket.due_date >= due_from)
    if due_to is not None:
        filters.append(Ticket.due_date <= due_to)

    # `total` counts everything matching the filters, not the page, so the UI
    # can show "50 of 1,204" without a second request.
    total = session.exec(select(func.count()).select_from(Ticket).where(*filters)).one()

    tickets = session.exec(
        select(Ticket)
        .where(*filters)
        .order_by(*_ordering(sort, direction, rank_order(session)))
        .offset(offset)
        .limit(limit)
    ).all()

    return Page(
        items=_expand_tickets(list(tickets), session),
        total=total,
        limit=limit,
        offset=offset,
    )


def _build_ticket_filters(
    session: Session,
    current_user: User,
    team_id: int,
    project_id: Optional[int] = None,
    status_id: Optional[int] = None,
    priority: Optional[TicketPriority] = None,
    assignee_id: Optional[int] = None,
    unassigned: bool = False,
    label_id: Optional[int] = None,
    parent_id: Optional[int] = None,
    sprint_id: Optional[int] = None,
) -> list[ColumnElement[bool]]:
    """The WHERE clauses for a team's ticket list, after checking who is asking.

    Shared by `list_tickets` and `export_tickets` so the two cannot drift: an
    export that quietly matched a different set of tickets than the board it
    was taken from would be worse than no export at all. The membership check
    lives here for the same reason -- it is the one clause that must never be
    forgotten by a new caller.
    """
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)

    filters: list[ColumnElement[bool]] = [Ticket.team_id == team_id]
    if project_id is not None:
        filters.append(Ticket.project_id == project_id)
    if status_id is not None:
        filters.append(Ticket.status_id == status_id)
    if priority is not None:
        filters.append(Ticket.priority == priority)
    if unassigned:
        # Distinct from leaving assignee_id null, which means "anybody".
        filters.append(Ticket.assignee_id == None)  # noqa: E711 -- SQL IS NULL
    elif assignee_id is not None:
        filters.append(Ticket.assignee_id == assignee_id)
    if label_id is not None:
        # A subquery rather than a join: a ticket joined to its label links
        # would come back once per matching link, so `list_tickets` would count
        # it that many times and the export would repeat the row.
        filters.append(
            Ticket.id.in_(
                select(TicketLabelLink.ticket_id).where(
                    TicketLabelLink.label_id == label_id
                )
            )
        )
    if parent_id is not None:
        filters.append(Ticket.parent_id == parent_id)
    if sprint_id is not None:
        filters.append(Ticket.sprint_id == sprint_id)

    return filters


#: How many tickets an export reads, expands and hands over at a time.
#:
#: The export is deliberately unpaginated -- a spreadsheet of "the fifty most
#: recent" is not what anyone asks for -- which is exactly why it cannot load
#: the result set in one go. Batching bounds both halves of the cost: the rows
#: held in memory at once, and the `IN (...)` lists `_expand_tickets` builds
#: from them. 500 is large enough that the per-batch queries stay amortised
#: and small enough that a team with a hundred thousand tickets exports in
#: constant memory.
EXPORT_BATCH_SIZE = 500


class TicketExportRow(NamedTuple):
    """One ticket, with the related names an export has to spell out.

    `TicketRead` carries `project_id` and `sprint_id` but not their names,
    because every client that renders a board is already holding both lists.
    A file someone opens in a spreadsheet has no such context, so the names
    are resolved alongside the ticket -- batched, not one lookup per row.
    """

    ticket: TicketRead
    project_name: str
    sprint_name: str


def export_tickets(
    session: Session,
    current_user: User,
    team_id: int,
    project_id: Optional[int] = None,
    status_id: Optional[int] = None,
    priority: Optional[TicketPriority] = None,
    assignee_id: Optional[int] = None,
    unassigned: bool = False,
    label_id: Optional[int] = None,
    parent_id: Optional[int] = None,
    sprint_id: Optional[int] = None,
) -> Iterator[list[TicketExportRow]]:
    """Every ticket matching the filters, newest number first, in batches.

    Two halves, and the split is the point. The team lookup, the membership
    check and the filters are resolved *now*, against the caller's session, so
    an export nobody is allowed to run fails with a status code instead of a
    200 whose body turns into an error halfway down. Everything after that is
    lazy, because the caller is a streaming response: see
    `_export_batches` for why it opens a session of its own.
    """
    filters = _build_ticket_filters(
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
        sprint_id=sprint_id,
    )
    return _export_batches(filters, session.get_bind(), outside.confined_to(session))


def _export_batches(
    filters: list[ColumnElement[bool]],
    bind: Union[Engine, Connection],
    confined_to: Optional[int] = None,
) -> Iterator[list[TicketExportRow]]:
    """Walk the matching tickets a batch at a time, on a session of our own.

    The request's session is deliberately not used here. Whether FastAPI
    closes a `yield` dependency before or after a streaming body has moved
    between versions, and reaching for a closed session would not even raise:
    SQLAlchemy quietly checks out another connection that nothing in the
    request scope will ever hand back. Owning the session makes the lifetime
    explicit either way, and it is bound to the caller's engine rather than
    the module's so it follows whatever database the request was using --
    which is also how the tests' `get_session` override reaches this.

    Paged by ticket number rather than OFFSET: `(team_id, number)` is unique
    and every filter set pins the team, so this is both a stable cursor and
    one the index can seek to, where a deep OFFSET re-scans everything it
    skips.

    Being a session of our own, it is confined to an outside account's epics
    (#243) here as the request's was, or the export would be the one place
    the rest of the team showed.
    """
    with Session(bind) as session:
        outside.confine_to(session, confined_to)
        before: Optional[int] = None
        while True:
            window = list(filters)
            if before is not None:
                window.append(Ticket.number < before)

            tickets = list(
                session.exec(
                    select(Ticket)
                    .where(*window)
                    .order_by(Ticket.number.desc())
                    .limit(EXPORT_BATCH_SIZE)
                ).all()
            )
            if not tickets:
                return

            yield _export_rows(tickets, session)

            if len(tickets) < EXPORT_BATCH_SIZE:
                return
            before = tickets[-1].number


def _export_rows(tickets: list[Ticket], session: Session) -> list[TicketExportRow]:
    """Expand one batch, resolving project and sprint names in one query each."""
    project_names = {
        project.id: project.name
        for project in session.exec(
            select(Project).where(
                Project.id.in_(
                    {ticket.project_id for ticket in tickets if ticket.project_id}
                )
            )
        ).all()
    }
    sprint_names = {
        sprint.id: sprint_display_name(sprint)
        for sprint in session.exec(
            select(Sprint).where(
                Sprint.id.in_(
                    {ticket.sprint_id for ticket in tickets if ticket.sprint_id}
                )
            )
        ).all()
    }

    return [
        TicketExportRow(
            ticket=read,
            # `.get` rather than an `is None` check: a ticket with no project
            # and one pointing at a deleted row both mean "no name to print".
            project_name=project_names.get(read.project_id, ""),
            sprint_name=sprint_names.get(read.sprint_id, ""),
        )
        for read in _expand_tickets(tickets, session)
    ]


def _readable(session: Session, current_user: User, ticket: Optional[Ticket]) -> Ticket:
    """A ticket somebody on its team may read, or why not.

    Read with the trash included (#323), so a link to a deleted ticket gets
    410 `ticket_in_trash` -- and a page that says who deleted it and offers it
    back -- rather than a 404 that reads as a typo.
    """
    if ticket is None:
        raise api_error(
            status_code=404, code=ErrorCode.ticket_not_found, detail="Ticket not found"
        )
    require_team_member(ticket.team_id, current_user, session)
    if ticket.deleted_at is not None:
        team = session.get(Team, ticket.team_id)
        raise api_error(
            status_code=410,
            code=ErrorCode.ticket_in_trash,
            detail=f"{team.key}-{ticket.number} is in the trash",
            # A 410 is cacheable by default, and browsers do cache it: the
            # page that restores the ticket would be served the old answer.
            headers={"Cache-Control": "no-store"},
        )
    return ticket


def get_ticket(session: Session, current_user: User, ticket_id: int) -> TicketRead:
    ticket = session.get(Ticket, ticket_id, execution_options=INCLUDE_TRASHED)
    return ticket_to_read(_readable(session, current_user, ticket), session)


def get_ticket_by_number(
    session: Session, current_user: User, team_id: int, number: int
) -> TicketRead:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    ticket = session.exec(
        select(Ticket)
        .where(Ticket.team_id == team_id, Ticket.number == number)
        .execution_options(**INCLUDE_TRASHED)
    ).one_or_none()
    return ticket_to_read(_readable(session, current_user, ticket), session)


def update_ticket(
    session: Session, current_user: User, ticket_id: int, payload: TicketUpdate
) -> TicketRead:
    ticket = get_ticket_or_404(session, ticket_id)
    require_team_member(ticket.team_id, current_user, session)

    _apply_update(
        session,
        current_user,
        ticket,
        payload.model_dump(exclude_unset=True, exclude={"label_ids", "custom_fields"}),
        payload.label_ids,
        payload.custom_fields,
    )

    session.commit()
    session.refresh(ticket)
    return ticket_to_read(ticket, session)


def _apply_update(
    session: Session,
    current_user: User,
    ticket: Ticket,
    data: dict,
    label_ids: Optional[list[int]],
    custom_fields: Optional[dict] = None,
) -> None:
    """Change one ticket and everything that follows from it, without committing.

    Shared by the single PATCH and the bulk edit, so a ticket changed twenty
    at a time gets the same history, notifications and automation runs as one
    changed by hand. Committing is the caller's job: the bulk edit needs every
    ticket's changes in one transaction.
    """
    before = snapshot(ticket)
    hook_before = outbound.snapshot(ticket)
    # Three snapshots of the same row, and three different questions about it.
    # History tracks what can be charted, notifications track what somebody
    # would want to be told about, and automation tracks what a rule can fire
    # on. They overlap without being the same list, and folding them together
    # would mean every field added to one answer being added to all three.
    watched_before = notifications_service.snapshot(ticket)
    rule_before = rules_service.snapshot(ticket)
    if data.get("status_id") is not None:
        # Moving a ticket into another team's column would take it off its own
        # board entirely.
        resolve_for_team(session, ticket.team_id, data["status_id"])
    if data.get("parent_id") is not None:
        # Validate before assigning, so a rejected parent leaves the ticket
        # exactly as it was rather than half-updated.
        validate_parent(session, ticket, data["parent_id"])
    # The check the bulk edit makes up front, made here for the single PATCH
    # too: another team's project satisfies the foreign key, and would file
    # the ticket under an epic its own team cannot open.
    _require_on_team(
        session, Project, data.get("project_id"), ticket.team_id, "project"
    )
    # Only a change is checked, so an edit that sends the assignee back as it
    # was still saves on a ticket assigned before guests could not be (#316).
    if "assignee_id" in data and data["assignee_id"] != ticket.assignee_id:
        require_assignable(ticket.team_id, data["assignee_id"], session)
    # The team's own fields (#117) after the type, which decides which of
    # them this ticket has -- and checked before anything is set, so a bad
    # value leaves the ticket as it was.
    field_changes = custom_fields_service.resolve(
        session,
        ticket.team_id,
        ticket.id,
        data.get("type") or ticket.type,
        custom_fields or {},
    )
    for field, value in data.items():
        setattr(ticket, field, value)
    ticket.updated_at = datetime.now(timezone.utc)
    session.add(ticket)

    if label_ids is not None:
        set_labels(ticket.id, label_ids, session)
    applied = custom_fields_service.write(session, ticket, field_changes, current_user)

    record_changes(session, ticket, before, current_user)
    notifications_service.on_ticket_updated(
        session, ticket, watched_before, current_user, named=applied.named
    )
    # Before the rules run, so what a person did and what a rule then did
    # arrive as separate deliveries -- the same split history keeps.
    outbound.ticket_changed(
        session, ticket, hook_before, current_user, extra=applied.webhook_changes
    )
    # Last, so a rule reads the ticket as the update left it -- and so its own
    # changes are recorded as a separate step in the history rather than
    # folded into the one the person made.
    rules_service.on_ticket_updated(session, ticket, rule_before, current_user)


def hand_over_open_tickets(
    session: Session,
    current_user: User,
    team_id: int,
    user_id: int,
    reassign_to: Optional[int],
) -> None:
    """Give somebody's open tickets on a team to `reassign_to`, or to nobody.

    For somebody leaving the team or made a guest, who may no longer hold its
    tickets (#316). Each goes through the same update as a change made by
    hand, so its history says who took it off them, the new assignee is told,
    and webhooks and rules hear of it. Done and cancelled tickets keep their
    assignee. Nothing is committed: the change of membership and the handover
    are one transaction, the caller's.
    """
    tickets = session.exec(
        select(Ticket)
        .where(
            Ticket.team_id == team_id,
            Ticket.assignee_id == user_id,
            ~in_category(*RESOLVED),
        )
        .order_by(Ticket.number)
    ).all()
    for ticket in tickets:
        _apply_update(session, current_user, ticket, {"assignee_id": reassign_to}, None)


#: Most urgent highest, so "descending" reads as "most urgent first" -- the
#: way a person means "sort by priority".
PRIORITY_RANK = {
    TicketPriority.urgent: 4,
    TicketPriority.high: 3,
    TicketPriority.medium: 2,
    TicketPriority.low: 1,
    TicketPriority.no_priority: 0,
}


def _ordering(sort: TicketSort, direction: SortDirection, rank) -> list:
    """ORDER BY for the ticket list (#88).

    Every ordering ends on the ticket number, newest first, so tickets that
    tie -- the same priority, no estimate -- come back in a stable order
    and a page boundary never splits or repeats them.
    """
    descending = direction == SortDirection.desc
    newest_first = Ticket.number.desc()
    if sort == TicketSort.created:
        return [newest_first if descending else Ticket.number.asc()]
    if sort == TicketSort.rank:
        key = rank
    elif sort == TicketSort.updated:
        key = Ticket.updated_at
    elif sort == TicketSort.priority:
        key = case(
            *[(Ticket.priority == p, rank) for p, rank in PRIORITY_RANK.items()],
            else_=0,
        )
    elif sort == TicketSort.title:
        key = func.lower(Ticket.title)
    else:
        # Unsized last whichever way round: an estimate of "none" is not a
        # small estimate, and sorting it among the ones would say it was.
        return [
            Ticket.estimate.is_(None),
            Ticket.estimate.desc() if descending else Ticket.estimate.asc(),
            newest_first,
        ]
    return [key.desc() if descending else key.asc(), newest_first]


def _due_filter(due: DueFilter, today: date):
    """One of the three due-date questions, as a condition on Ticket (#87)."""
    if due == DueFilter.none:
        return Ticket.due_date == None  # noqa: E711 -- SQL IS NULL
    if due == DueFilter.overdue:
        # Late only while it is still open: finished work is not overdue,
        # however late it was finished.
        return (Ticket.due_date < today) & ~in_category(*RESOLVED)
    # Monday is 0, so this is the coming Sunday -- or today, on a Sunday.
    end_of_week = today + timedelta(days=6 - today.weekday())
    return (Ticket.due_date >= today) & (Ticket.due_date <= end_of_week)


def move_ticket(
    session: Session, current_user: User, ticket_id: int, payload: TicketMove
) -> TicketRead:
    """Drop a card between two others on the board, maybe in another column.

    One row changes: the card's own rank, between its new neighbours'. A
    change of column goes through the ordinary update path first, so it
    records history, notifies and runs rules exactly as a status change from
    the ticket panel does.
    """
    ticket = get_ticket_or_404(session, ticket_id)
    require_team_member(ticket.team_id, current_user, session)
    above = neighbour_or_404(session, ticket, payload.above_id)
    below = neighbour_or_404(session, ticket, payload.below_id)

    if payload.status_id is not None and payload.status_id != ticket.status_id:
        _apply_update(
            session, current_user, ticket, {"status_id": payload.status_id}, None
        )

    if above is None and below is None:
        # An empty column, or nothing said: the top, like a new card.
        ticket.rank = top_rank(session, ticket.team_id)
    else:
        ticket.rank = rank_between(session, above, below)
    ticket.updated_at = datetime.now(timezone.utc)
    session.add(ticket)
    session.commit()
    session.refresh(ticket)
    return ticket_to_read(ticket, session)


def _delete_rows(session: Session, ticket: Ticket) -> list[str]:
    """Remove one ticket and its dependents, without committing.

    Returns the attachment keys whose bytes should be purged once the caller
    has committed -- see `attachments.take_keys_for_ticket`.
    """
    ticket_id = ticket.id

    # Clear the rows that point at this ticket before removing it. Postgres
    # enforces these foreign keys and rejects the delete otherwise; SQLite only
    # does so with PRAGMA foreign_keys=ON, which is why this survived until the
    # stack moved to Postgres (soft-track#1).
    #
    # Done in the service rather than with ON DELETE CASCADE because the schema
    # is still created by SQLModel.metadata.create_all, so a constraint change
    # would never reach an existing database. Worth revisiting once Alembic
    # lands (soft-track#5).
    label_links = session.exec(
        select(TicketLabelLink).where(TicketLabelLink.ticket_id == ticket_id)
    ).all()
    for link in label_links:
        session.delete(link)

    # Before the comments below, and flushed rather than left queued: a
    # notification holds a foreign key to the comment it is about, and with no
    # relationship configured between the two tables SQLAlchemy has no
    # dependency graph to order one flush's DELETEs by. Emitting these now is
    # what makes "notifications first" true of the SQL and not just of the
    # Python -- the distinction that let soft-track#1 through.
    notifications_service.delete_for_ticket(session, ticket_id)
    # Same reasoning, same place: a run-log row about a ticket that no longer
    # exists is a link to a 404, and it holds a foreign key to this row.
    automations_service.delete_runs_for_ticket(session, ticket_id)
    # And the branches, commits and pull requests linked to it. Same reason
    # again: the rows hold a foreign key here, and a link to the code for a
    # ticket that no longer exists is not worth keeping.
    integrations_service.delete_links_for_ticket(session, ticket_id)
    # And the time logged against it (#102). Imported here because the
    # worklog service reads tickets through this module.
    from lib_softtrack import worklogs as worklogs_service

    worklogs_service.delete_for_ticket(session, ticket_id)
    # And its values for the team's own fields (#117).
    custom_fields_service.delete_for_ticket(session, ticket_id)
    session.flush()

    # Attachments before comments: a comment attachment holds a foreign key to
    # the comment, so removing the comment first is the delete Postgres
    # rejects. The bytes are purged after the commit below -- an orphaned file
    # costs disk, an orphaned row costs a broken image on somebody's ticket.
    storage_keys = attachments_service.take_keys_for_ticket(session, ticket_id)

    # Reactions hold a foreign key to the comment, so they go first -- and are
    # flushed first, for the reason given for notifications above.
    reactions_service.delete_for_ticket(session, ticket_id)
    session.flush()

    comments = session.exec(select(Comment).where(Comment.ticket_id == ticket_id)).all()
    for comment in comments:
        session.delete(comment)

    # Links point at this ticket from either end, so both have to go -- and the
    # relationship is gone for the ticket at the other end too, which is the
    # right outcome: it was a relationship *with* something that no longer
    # exists.
    ticket_links = session.exec(
        select(TicketLink).where(
            or_(TicketLink.source_id == ticket_id, TicketLink.target_id == ticket_id)
        )
    ).all()
    for link in ticket_links:
        session.delete(link)

    # History rows point at the ticket, so they go with it. There is no
    # reporting value in events for a ticket that no longer exists, and
    # keeping them would mean every report having to tolerate dangling ids.
    for event in session.exec(
        select(TicketEvent).where(TicketEvent.ticket_id == ticket_id)
    ).all():
        session.delete(event)

    # Children are promoted to top level rather than deleted. Losing a parent
    # should not lose the work underneath it -- that is a lot of data to
    # destroy with one click, and the children are usually the part worth
    # keeping. They also hold a foreign key to this row, so they have to be
    # dealt with either way.
    detach_children(session, ticket_id)

    # Flush every dependent change before removing the ticket itself. Without a
    # relationship configured between these tables SQLAlchemy has no
    # dependency graph to order the statements by, so it is free to emit the
    # parent DELETE first and trip a foreign key. The comment and label
    # deletes above happened to be ordered correctly; this makes all of them
    # deterministic rather than lucky.
    session.flush()

    session.delete(ticket)
    return storage_keys


# ---------------------------------------------------------------------------
# Bulk edit
# ---------------------------------------------------------------------------


def _team_tickets_or_404(
    session: Session, team_id: int, ticket_ids: list[int]
) -> list[Ticket]:
    """Every requested ticket, in the order asked for, or a 404 for all of them.

    Scoped to the team in the path: an id from another team is reported as
    not found rather than forbidden, the same answer a single GET gives, so
    the endpoint cannot be used to probe which ids exist elsewhere.
    """
    wanted = list(dict.fromkeys(ticket_ids))
    found = {
        ticket.id: ticket
        for ticket in session.exec(
            select(Ticket).where(Ticket.team_id == team_id, Ticket.id.in_(wanted))
        ).all()
    }
    missing = [ticket_id for ticket_id in wanted if ticket_id not in found]
    if missing:
        raise api_error(
            status_code=404,
            code=ErrorCode.tickets_not_found,
            detail="Tickets not found on this team: "
            + ", ".join(str(ticket_id) for ticket_id in missing),
        )
    return [found[ticket_id] for ticket_id in wanted]


def _require_on_team(
    session: Session, model: type, row_id: Optional[int], team_id: int, noun: str
) -> None:
    """A project, sprint or label id from the request, checked against the team.

    Checked once up front rather than left to the foreign key: a row from
    another team satisfies the foreign key and would quietly file twenty
    tickets somewhere their own board cannot see.
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
    session: Session, team_id: int, changes: TicketBulkChanges
) -> None:
    resolve_for_team(session, team_id, changes.status_id)
    _require_on_team(session, Project, changes.project_id, team_id, "project")
    _require_on_team(session, Sprint, changes.sprint_id, team_id, "sprint")
    for label_id in {*changes.add_label_ids, *changes.remove_label_ids}:
        _require_on_team(session, Label, label_id, team_id, "label")
    if set(changes.add_label_ids) & set(changes.remove_label_ids):
        raise api_error(
            status_code=400,
            code=ErrorCode.labels_conflict,
            detail="A label cannot be both added and removed.",
        )
    require_assignable(team_id, changes.assignee_id, session)


def _bulk_label_ids(
    session: Session, ticket: Ticket, add: list[int], remove: list[int]
) -> Optional[list[int]]:
    """The ticket's label set after the add and remove, or None if unchanged."""
    if not add and not remove:
        return None
    current = set(
        session.exec(
            select(TicketLabelLink.label_id).where(
                TicketLabelLink.ticket_id == ticket.id
            )
        ).all()
    )
    wanted = (current | set(add)) - set(remove)
    return sorted(wanted) if wanted != current else None


def bulk_update_tickets(
    session: Session, current_user: User, team_id: int, payload: TicketBulkUpdate
) -> list[TicketRead]:
    """Apply one set of changes to many tickets, all of them or none.

    Everything that can be checked once is checked before anything changes.
    What can only fail per ticket fails inside the transaction, and the whole
    batch is rolled back rather than leaving the first half changed: a bulk
    edit that stops partway leaves somebody to work out which half landed.
    """
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    tickets = _team_tickets_or_404(session, team_id, payload.ticket_ids)

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
        for ticket in tickets:
            _apply_update(
                session,
                current_user,
                ticket,
                data,
                _bulk_label_ids(
                    session, ticket, changes.add_label_ids, changes.remove_label_ids
                ),
            )
        session.commit()
    except Exception:
        session.rollback()
        raise

    return _expand_tickets(tickets, session)
