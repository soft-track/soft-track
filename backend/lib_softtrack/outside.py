"""People from outside the organisation, and the epics they are given (#243).

An account can be *external*: a client, a partner, somebody the work is for
rather than somebody doing it. On a team such an account is only ever a
guest, and its membership reaches the tickets of the epics it was given there
(`GuestEpic`) and nothing else: not the rest of the board, not the backlog,
not the other epics. No epic given means no tickets.

**Where it is enforced: the ORM, as the trash is.** When the account signed
in is external, `confine` marks the request's session, and a listener adds
"in one of their epics" to every ORM query that reads tickets, epics or
ticket history -- joins, subqueries, `session.get` and relationship loads
included. One place rather than a clause at each of the eighty places tickets
are read: a report or a filter added next year is confined without anyone
remembering to. For that account a ticket outside its epics does not exist,
so every route that resolves a ticket answers what it answers a stranger.
`tests/test_external_accounts.py` sends every read route as one and looks for
anything out of reach in the answers.

Live updates (`realtime.py`) are nudges carrying an id and nothing else; the
browser refetches through the same confined routes.
"""

from collections.abc import Iterable
from typing import Optional

from sqlalchemy import event
from sqlalchemy import select as sa_select
from sqlalchemy.orm import ORMExecuteState, with_loader_criteria
from sqlalchemy.orm import Session as OrmSession
from sqlmodel import Session, select

from lib_softtrack.tables import (
    GuestEpic,
    Project,
    TeamRole,
    Ticket,
    TicketEvent,
    User,
)
from lib_utils.errors import ErrorCode, api_error

#: The tables rather than the models inside the criteria below: the models
#: would have the criteria put on them too, recursively.
_TICKETS = Ticket.__table__
_GUEST_EPICS = GuestEpic.__table__
_PROJECTS = Project.__table__

_CONFINED_TO = "confined_to_the_epics_of"


def confine(session: Session, user: User) -> None:
    """Confine `session` to what `user` may see, if they are from outside.

    Called once the request knows who is asking (`get_current_user`). Nothing
    changes for anybody else -- and the mark is taken off for them, in case
    the session outlives one request, as the tests' does.
    """
    if user.is_external:
        session.info[_CONFINED_TO] = user.id
    else:
        session.info.pop(_CONFINED_TO, None)


def confined_to(session: Session) -> Optional[int]:
    """Whose epics `session` is confined to, if anybody's: for work that
    carries on in a session of its own, like a streamed export."""
    return session.info.get(_CONFINED_TO)


def confine_to(session: Session, user_id: Optional[int]) -> None:
    """Confine `session` as another one was (`confined_to`)."""
    if user_id is not None:
        session.info[_CONFINED_TO] = user_id


def _their_epics(user_id: int):
    return sa_select(_GUEST_EPICS.c.project_id).where(_GUEST_EPICS.c.user_id == user_id)


def _confine(state: ORMExecuteState) -> None:
    user_id = state.session.info.get(_CONFINED_TO)
    if user_id is None or not state.is_select:
        return
    state.statement = state.statement.options(
        with_loader_criteria(
            Ticket,
            lambda cls: cls.project_id.in_(_their_epics(user_id)),
            include_aliases=True,
        ),
        with_loader_criteria(
            Project,
            lambda cls: cls.id.in_(_their_epics(user_id)),
            include_aliases=True,
        ),
        # History is read on its own by the reports, without a ticket in the
        # query to hang the criteria above on.
        with_loader_criteria(
            TicketEvent,
            lambda cls: cls.ticket_id.in_(
                sa_select(_TICKETS.c.id).where(
                    _TICKETS.c.project_id.in_(_their_epics(user_id))
                )
            ),
            include_aliases=True,
        ),
    )


def install() -> None:
    """Confine external accounts' sessions. Idempotent; called once from main."""
    if event.contains(OrmSession, "do_orm_execute", _confine):
        return
    event.listen(OrmSession, "do_orm_execute", _confine)


# --- The epics a membership reaches ----------------------------------------


def epics_of(session: Session, user_id: int, team_id: int) -> list[Project]:
    """The epics `user_id` was given on `team_id`, by name."""
    return list(
        session.exec(
            select(Project)
            .join(GuestEpic, GuestEpic.project_id == Project.id)
            .where(GuestEpic.user_id == user_id, Project.team_id == team_id)
            .order_by(Project.name, Project.id)
        ).all()
    )


def epics_by_member(
    session: Session, team_id: int, user_ids: Iterable[int]
) -> dict[int, list[Project]]:
    """`epics_of` for a roster at once: one query, not one per row."""
    ids = list(user_ids)
    if not ids:
        return {}
    rows = session.exec(
        select(GuestEpic.user_id, Project)
        .join(Project, Project.id == GuestEpic.project_id)
        .where(GuestEpic.user_id.in_(ids), Project.team_id == team_id)
        .order_by(Project.name, Project.id)
    ).all()
    found: dict[int, list[Project]] = {}
    for user_id, project in rows:
        found.setdefault(user_id, []).append(project)
    return found


def _live(session: Session, team_id: int, epic_ids: list[int]) -> set[int]:
    # The table, so the trash's criteria and these do not apply: an admin
    # choosing epics is told plainly which are gone.
    return set(
        session.exec(
            sa_select(_PROJECTS.c.id).where(
                _PROJECTS.c.id.in_(epic_ids),
                _PROJECTS.c.team_id == team_id,
                _PROJECTS.c.deleted_at.is_(None),
            )
        ).scalars()
    )


def check_epics(session: Session, team_id: int, epic_ids: Iterable[int]) -> list[int]:
    """The ids, each one an epic of this team and not in the trash; or a 400
    naming the first that is not."""
    chosen = list(dict.fromkeys(epic_ids))
    if not chosen:
        return []
    found = _live(session, team_id, chosen)
    missing = [epic_id for epic_id in chosen if epic_id not in found]
    if missing:
        raise api_error(
            status_code=400,
            code=ErrorCode.not_on_this_team,
            detail=f"Epic {missing[0]} is not one of this team's",
        )
    return chosen


def live_epics(session: Session, team_id: int, epic_ids: Iterable[int]) -> list[int]:
    """The ids that are still this team's epics, quietly dropping the rest --
    for an invitation accepted after an epic it named was deleted."""
    chosen = list(dict.fromkeys(epic_ids))
    if not chosen:
        return []
    found = _live(session, team_id, chosen)
    return [epic_id for epic_id in chosen if epic_id in found]


def set_epics(
    session: Session, team_id: int, user_id: int, epic_ids: Iterable[int]
) -> None:
    """Give `user_id` exactly these epics of `team_id`, already checked."""
    keep = set(epic_ids)
    current = {
        row.project_id: row
        for row in session.exec(
            select(GuestEpic)
            .join(Project, Project.id == GuestEpic.project_id)
            .where(GuestEpic.user_id == user_id, Project.team_id == team_id)
            .execution_options(include_trashed=True)
        ).all()
    }
    for project_id, row in current.items():
        if project_id not in keep:
            session.delete(row)
    for project_id in keep - set(current):
        session.add(GuestEpic(user_id=user_id, project_id=project_id))


def forget_team(session: Session, team_id: int, user_id: int) -> None:
    """Drop the epics `user_id` had on `team_id`, when they leave it."""
    set_epics(session, team_id, user_id, [])


def forget_epic(session: Session, project_id: int) -> None:
    """Drop every guest's hold on an epic that is going for good."""
    for row in session.exec(
        select(GuestEpic).where(GuestEpic.project_id == project_id)
    ).all():
        session.delete(row)


# --- Who may hear about a ticket -------------------------------------------


def unable_to_see(
    session: Session, ticket: Ticket, user_ids: Iterable[int]
) -> set[int]:
    """Of `user_ids`, the accounts from outside whose epics do not include the
    ticket's: mentioning or watching cannot reach them, because the ticket
    does not exist for them."""
    ids = {user_id for user_id in user_ids if user_id is not None}
    if not ids:
        return set()
    external = set(
        session.exec(
            select(User.id).where(
                User.id.in_(ids), User.is_external == True  # noqa: E712
            )
        ).all()
    )
    if not external:
        return set()
    if ticket.project_id is None:
        return external
    allowed = set(
        session.exec(
            select(GuestEpic.user_id).where(
                GuestEpic.user_id.in_(external),
                GuestEpic.project_id == ticket.project_id,
            )
        ).all()
    )
    return external - allowed


def refuse_unless_guest(user: User, role: object, name: Optional[str] = None) -> None:
    """An account from outside joins a team as a guest, and only as one."""
    if user.is_external and role != TeamRole.guest:
        raise api_error(
            status_code=400,
            code=ErrorCode.external_account_is_guest,
            detail=f"{name or user.full_name} is from outside the organisation, "
            "so they can only be a guest",
        )
