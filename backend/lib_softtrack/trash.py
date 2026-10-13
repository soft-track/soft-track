"""Keeping what is in the trash out of sight (#323).

A deleted ticket or epic is not deleted at once. It gets `deleted_at` and
`deleted_by_id`, keeps every row that points at it -- comments, links,
attachments, history, an epic's tickets -- and is purged later.

**Where it is hidden: the ORM, not the services.** A session listener adds
"not in the trash" to every ORM query that reads tickets, projects or ticket
history, joins and subqueries included. One place rather than a clause at each
of the eighty places tickets are read, for the reason live updates come from
the ORM too (see realtime.py): a report or a filter added next year leaves the
trash out without anyone remembering to. Boards, lists, search, counts,
workloads, links, sub-ticket and epic progress follow, and so do the reports,
which are replayed from `ticketevent` rather than read from tickets.

A query that means to reach the trash says so, with
`.execution_options(include_trashed=True)` (`INCLUDE_TRASHED` on
`session.get`): the trash page, restoring, and the page a link to a deleted
ticket leads to. Work that has to reach every row, trashed or not, runs
inside `seeing_the_trash(session)`: purging, which removes a ticket's history
with it, and the writes that must re-point every ticket at something before
it is removed -- a status, a sprint -- or the database would refuse the
delete.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event, select
from sqlalchemy.orm import ORMExecuteState, Session, with_loader_criteria

from lib_softtrack.tables import Project, Ticket, TicketEvent

#: The execution options for a query that reads the trash too.
INCLUDE_TRASHED = {"include_trashed": True}

#: The table rather than the model, in the history criteria below: the
#: model would have the ticket criteria put on it too, which would empty the
#: very subquery that names the trashed tickets.
_TICKETS = Ticket.__table__

_SEES_THE_TRASH = "sees_the_trash"


@contextmanager
def seeing_the_trash(session: Session) -> Iterator[None]:
    """Every query on `session` reaches the trash until the block ends."""
    before = session.info.get(_SEES_THE_TRASH, False)
    session.info[_SEES_THE_TRASH] = True
    try:
        yield
    finally:
        session.info[_SEES_THE_TRASH] = before


def _hide_trashed(state: ORMExecuteState) -> None:
    if (
        not state.is_select
        or state.execution_options.get("include_trashed")
        or state.session.info.get(_SEES_THE_TRASH)
    ):
        return
    state.statement = state.statement.options(
        with_loader_criteria(
            Ticket, lambda cls: cls.deleted_at.is_(None), include_aliases=True
        ),
        with_loader_criteria(
            Project, lambda cls: cls.deleted_at.is_(None), include_aliases=True
        ),
        # History is read on its own by the reports, without a ticket in the
        # query to hang the criteria above on.
        with_loader_criteria(
            TicketEvent,
            lambda cls: cls.ticket_id.not_in(
                select(_TICKETS.c.id).where(_TICKETS.c.deleted_at.is_not(None))
            ),
            include_aliases=True,
        ),
    )


def install() -> None:
    """Hide the trash from every session. Idempotent; called once from main."""
    if event.contains(Session, "do_orm_execute", _hide_trashed):
        return
    event.listen(Session, "do_orm_execute", _hide_trashed)
