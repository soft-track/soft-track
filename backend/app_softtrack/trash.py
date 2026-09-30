from fastapi import APIRouter, Depends, Response
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_user
from lib_softtrack import deleting
from lib_softtrack.models.projects import ProjectRead
from lib_softtrack.models.tickets import TicketRead
from lib_softtrack.models.trash import Trash, TrashedTicket
from lib_softtrack.storage import Storage, get_storage
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["trash"])


@router.get("/teams/{team_id}/trash", response_model=Trash)
def list_trash(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """The team's deleted tickets and epics, newest first, with who deleted
    each and when it is purged (#323)."""
    return deleting.list_trash(session, current_user, team_id)


@router.get("/teams/{team_id}/trash/tickets/{number}", response_model=TrashedTicket)
def get_trashed_ticket(
    team_id: int,
    number: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """One deleted ticket, by number: what a link to it can say. The ticket
    itself answers 410 `ticket_in_trash` while it is in here."""
    return deleting.trashed_ticket(session, current_user, team_id, number)


@router.post(
    "/trash/tickets/{ticket_id}/restore",
    response_model=TicketRead,
    dependencies=[team_writer],
)
def restore_ticket(
    ticket_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Bring a ticket back with everything it had. Anybody on the team but a
    guest."""
    return deleting.restore_ticket(session, current_user, ticket_id)


@router.delete(
    "/trash/tickets/{ticket_id}", status_code=204, dependencies=[team_writer]
)
def purge_ticket(
    ticket_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    current_user: User = Depends(get_current_user),
):
    """Delete a ticket in the trash forever, before the trash would. Team
    admins only. Its comments, links, history and attachments go with it;
    its sub-tickets are promoted to the top level."""
    deleting.purge_ticket(session, current_user, ticket_id, storage)
    return Response(status_code=204)


@router.post(
    "/trash/projects/{project_id}/restore",
    response_model=ProjectRead,
    dependencies=[team_writer],
)
def restore_project(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Bring an epic back. The tickets that were in it are in it again."""
    return deleting.restore_project(session, current_user, project_id)


@router.delete(
    "/trash/projects/{project_id}", status_code=204, dependencies=[team_writer]
)
def purge_project(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Delete an epic in the trash forever. Team admins only. Its tickets are
    kept, with no epic."""
    deleting.purge_project(session, current_user, project_id)
    return Response(status_code=204)
