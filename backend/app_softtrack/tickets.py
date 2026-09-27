import csv
import io
from collections.abc import Iterable, Iterator
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_user
from lib_identity.models.identity import UserPublic
from lib_softtrack import estimates as estimates_service
from lib_softtrack import history as history_service
from lib_softtrack import tickets as tickets_service
from lib_softtrack import links as links_service
from lib_softtrack import transfers as transfers_service
from lib_softtrack.tickets import TicketExportRow
from lib_softtrack.models.estimates import EstimateSummary
from lib_softtrack.models.history import TicketEventRead
from lib_softtrack.models.tickets import (
    TicketBulkDelete,
    TicketBulkUpdate,
    TicketCreate,
    TicketMove,
    TicketRead,
    TicketUpdate,
)
from lib_softtrack.models.links import TicketLinkCreate, TicketLinkRead, TicketLinks
from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT, Page
from lib_softtrack.storage import Storage, get_storage
from lib_softtrack.models.transfers import (
    TicketTransfer,
    TransferPlan,
    TransferResult,
)
from lib_softtrack.tables import (
    DueFilter,
    TicketPriority,
    TicketSort,
    TicketType,
    SortDirection,
    User,
)
from web import get_session

router = APIRouter(tags=["tickets"])

#: The export's columns, in order.
#:
#: Stable on purpose: an export is something people build a spreadsheet or a
#: script on top of, and reordering or renaming a column breaks every one of
#: those silently. Append, do not rearrange.
CSV_COLUMNS = [
    "key",
    "title",
    "description",
    "status",
    "priority",
    "assignee",
    "labels",
    "project",
    "sprint",
    "estimate",
    "creator",
    "created",
    "updated",
    "parent_key",
]


def _csv_timestamp(value: datetime) -> str:
    """Render a timestamp for the export as `YYYY-MM-DD HH:MM:SS`.

    `isoformat()` gives the `T` separator and microseconds, which spreadsheets
    show verbatim instead of parsing as a date.
    """
    return value.strftime("%Y-%m-%d %H:%M:%S")


def _csv_person(user: Optional[UserPublic]) -> str:
    """Who someone is in a spreadsheet: their username, or failing that their
    email. Nobody at all is an empty cell."""
    if user is None:
        return ""
    return user.username or user.email


#: What a spreadsheet takes a cell starting with to be a formula.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_text(value: str) -> str:
    """Text someone typed, made safe to open in a spreadsheet.

    Excel and Sheets run a cell starting with `=` (or `+`, `-`, `@`) as a
    formula, so a ticket titled `=HYPERLINK(...)` would run in the reader's
    spreadsheet. A leading `'` makes the cell plain text again.
    """
    return f"'{value}" if value.startswith(_FORMULA_PREFIXES) else value


def _csv_row(row: TicketExportRow) -> list[str]:
    """One ticket as the columns of `CSV_COLUMNS`, in that order."""
    ticket = row.ticket
    return [
        ticket.identifier,
        _csv_text(ticket.title),
        _csv_text(ticket.description or ""),
        _csv_text(ticket.status.name),
        ticket.priority.value,
        _csv_text(_csv_person(ticket.assignee)),
        _csv_text(";".join(label.name for label in ticket.labels)),
        _csv_text(row.project_name),
        _csv_text(row.sprint_name),
        "" if ticket.estimate is None else str(ticket.estimate),
        _csv_text(_csv_person(ticket.creator)),
        _csv_timestamp(ticket.created_at),
        _csv_timestamp(ticket.updated_at),
        ticket.parent.identifier if ticket.parent is not None else "",
    ]


def _csv_chunks(batches: Iterable[list[TicketExportRow]]) -> Iterator[bytes]:
    """Encode batches of tickets as CSV, one chunk of bytes per batch.

    The whole point of taking batches rather than a list is that this never
    holds more than one of them: the response goes out while the rest of the
    export is still being read.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)

    def drain() -> bytes:
        chunk = buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)
        return chunk.encode("utf-8")

    # A UTF-8 BOM, because Excel reads a BOM-less file as the machine's local
    # codepage and mangles every non-ASCII title in it.
    yield "\ufeff".encode("utf-8")
    writer.writerow(CSV_COLUMNS)
    yield drain()

    for batch in batches:
        for row in batch:
            writer.writerow(_csv_row(row))
        yield drain()


@router.post(
    "/teams/{team_id}/tickets", response_model=TicketRead, dependencies=[team_writer]
)
def create_ticket(
    team_id: int,
    payload: TicketCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return tickets_service.create_ticket(session, current_user, team_id, payload)


@router.get("/teams/{team_id}/tickets", response_model=Page[TicketRead])
def list_tickets(
    team_id: int,
    project_id: Optional[int] = None,
    status_id: Optional[int] = Query(None, description="Only tickets in this status."),
    priority: Optional[TicketPriority] = None,
    assignee_id: Optional[int] = None,
    unassigned: bool = Query(
        False, description="Only tickets with nobody assigned. Overrides assignee_id."
    ),
    label_id: Optional[int] = Query(None, description="Only tickets with this label."),
    parent_id: Optional[int] = Query(
        None, description="Only sub-tickets of this ticket."
    ),
    sprint_id: Optional[int] = Query(None, description="Only tickets in this sprint."),
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
        None, description="Only tickets due on or after this day."
    ),
    due_to: Optional[date] = Query(
        None, description="Only tickets due on or before this day."
    ),
    type: Optional[TicketType] = Query(None, description="Only tickets of this type."),
    sort: TicketSort = Query(TicketSort.created, description="What to order by."),
    direction: SortDirection = Query(
        SortDirection.desc,
        description="desc is newest, most urgent, largest, or Z first.",
    ),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return tickets_service.list_tickets(
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
    "/teams/{team_id}/tickets/bulk-update",
    response_model=list[TicketRead],
    dependencies=[team_writer],
)
def bulk_update_tickets(
    team_id: int,
    payload: TicketBulkUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Apply one set of changes to up to 200 of the team's tickets.

    Transactional: every ticket changes or none does. Returns the tickets as the
    batch left them, in the order they were asked for.
    """
    return tickets_service.bulk_update_tickets(session, current_user, team_id, payload)


@router.post(
    "/teams/{team_id}/tickets/bulk-delete", status_code=204, dependencies=[team_writer]
)
def bulk_delete_tickets(
    team_id: int,
    payload: TicketBulkDelete,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    current_user: User = Depends(get_current_user),
):
    """Delete up to 200 of the team's tickets, all of them or none.

    A POST rather than a DELETE with a body, which too many clients and
    proxies drop. Each ticket goes the way a single delete takes it --
    attachments with it, sub-tickets promoted.
    """
    tickets_service.bulk_delete_tickets(
        session, current_user, team_id, payload, storage
    )


@router.get(
    "/teams/{team_id}/tickets/export",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": "The matching tickets as a CSV file.",
            "content": {"text/csv": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
def export_tickets_csv(
    team_id: int,
    project_id: Optional[int] = None,
    status_id: Optional[int] = Query(None, description="Only tickets in this status."),
    priority: Optional[TicketPriority] = None,
    assignee_id: Optional[int] = None,
    unassigned: bool = Query(
        False, description="Only tickets with nobody assigned. Overrides assignee_id."
    ),
    label_id: Optional[int] = Query(None, description="Only tickets with this label."),
    parent_id: Optional[int] = Query(
        None, description="Only sub-tickets of this ticket."
    ),
    sprint_id: Optional[int] = Query(None, description="Only tickets in this sprint."),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Stream matching tickets as a CSV file.

    The same filters as the ticket list, and deliberately no `limit`: an export
    of the first page would be a worse spreadsheet than the board it came
    from. The service hands back batches rather than rows so that stays
    affordable -- nothing here, or under it, holds the whole team's tickets.
    """
    batches = tickets_service.export_tickets(
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

    return StreamingResponse(
        _csv_chunks(batches),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=tickets.csv"},
    )


@router.get("/teams/{team_id}/estimates", response_model=EstimateSummary)
def get_estimate_summary(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Story-point rollups by column and by assignee for the whole team.

    Separate from the ticket list because the list is paginated: summing a page
    would silently report the total of whatever the client happened to load.
    """
    return estimates_service.estimate_summary(session, current_user, team_id)


@router.get("/teams/{team_id}/tickets/by-number/{number}", response_model=TicketRead)
def get_ticket_by_number(
    team_id: int,
    number: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return tickets_service.get_ticket_by_number(session, current_user, team_id, number)


@router.post(
    "/tickets/{ticket_id}/move", response_model=TicketRead, dependencies=[team_writer]
)
def move_ticket(
    ticket_id: int,
    payload: TicketMove,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Place a card between two others on the board, optionally in another
    column. Its neighbours are named, never its new position's key -- the
    server works that out, so a client never has to."""
    return tickets_service.move_ticket(session, current_user, ticket_id, payload)


@router.get("/tickets/{ticket_id}/events", response_model=list[TicketEventRead])
def list_ticket_events(
    ticket_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """What has happened to a ticket: status, priority, assignee, estimate,
    sprint and project changes, oldest first, with who made each one.

    The latest 100 changes. The values a ticket was created with are its
    starting point rather than changes, and are left out.
    """
    return history_service.ticket_events(session, current_user, ticket_id)


@router.get("/tickets/{ticket_id}", response_model=TicketRead)
def get_ticket(
    ticket_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return tickets_service.get_ticket(session, current_user, ticket_id)


@router.patch(
    "/tickets/{ticket_id}", response_model=TicketRead, dependencies=[team_writer]
)
def update_ticket(
    ticket_id: int,
    payload: TicketUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return tickets_service.update_ticket(session, current_user, ticket_id, payload)


@router.delete("/tickets/{ticket_id}", status_code=204, dependencies=[team_writer])
def delete_ticket(
    ticket_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    current_user: User = Depends(get_current_user),
):
    """Delete a ticket and everything that only existed because of it.

    Attachments go with it, bytes included -- see
    `lib_softtrack/tickets.py`. Sub-tickets do not: they are promoted to top
    level rather than destroyed.
    """
    tickets_service.delete_ticket(session, current_user, ticket_id, storage)


@router.get("/tickets/{ticket_id}/links", response_model=TicketLinks)
def list_ticket_links(
    ticket_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Every relationship this ticket has, grouped by how it reads from here.

    A `blocks` row appears under `blocks` for the source ticket and under
    `blocked_by` for the target -- one stored row, two readings.
    """
    return links_service.list_links(session, current_user, ticket_id)


@router.post(
    "/tickets/{ticket_id}/links",
    response_model=TicketLinkRead,
    dependencies=[team_writer],
)
def create_ticket_link(
    ticket_id: int,
    payload: TicketLinkCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return links_service.create_link(session, current_user, ticket_id, payload)


@router.delete(
    "/tickets/{ticket_id}/links/{link_id}", status_code=204, dependencies=[team_writer]
)
def delete_ticket_link(
    ticket_id: int,
    link_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    links_service.delete_link(session, current_user, ticket_id, link_id)


@router.get("/tickets/{ticket_id}/transfer", response_model=TransferPlan)
def preview_transfer(
    ticket_id: int,
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """What moving the ticket to `team_id` would change, without changing it."""
    return transfers_service.preview_transfer(session, current_user, ticket_id, team_id)


# `transfer` rather than `move`: /tickets/{id}/move already exists, and is the
# board's drag -- a column and a place in it, on the same team.
@router.post(
    "/tickets/{ticket_id}/transfer",
    response_model=TransferResult,
    dependencies=[team_writer],
)
def transfer_ticket(
    ticket_id: int,
    payload: TicketTransfer,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Move the ticket, and its sub-tickets, to another team (#98).

    It takes the target team's next number, and whatever does not exist on the
    target team is remapped or cleared -- see `lib_softtrack/transfers.py`.
    Needs write access to both teams.
    """
    return transfers_service.transfer_ticket(
        session, current_user, ticket_id, payload.team_id
    )
