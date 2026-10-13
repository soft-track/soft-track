"""Manual order on the board (#88, part 2).

Every ticket has a `rank`, a fractional-indexing key (lib_utils/ranking.py),
and the board lists a team's tickets by it. It is one order for the whole
team rather than one per column: a card in "In Progress" and a card in
"Done" can each be above or below the other, which never shows, and never
has to be reconciled when a card changes column. Each column simply shows
its own cards in that order -- and "new tickets go on top of their column"
becomes "new tickets go before the team's first key".

Moving a card writes one row: its own key, between the keys of the cards it
was dropped between.
"""

from typing import Optional

from sqlmodel import Session, select

from lib_softtrack.tables import Ticket
from lib_utils.errors import ErrorCode, api_error
from lib_utils.ranking import RankError, key_between, keys_in_order


def rank_order(session: Session):
    """`Ticket.rank` as SQL should sort it: by code point.

    SQLite's default collation already does. On Postgres the column is
    declared `COLLATE "C"` by its migration; saying so again here keeps the
    order right even on a database created some other way.
    """
    if session.get_bind().dialect.name == "postgresql":
        return Ticket.rank.collate("C")
    return Ticket.rank


def top_rank(session: Session, team_id: int) -> str:
    """A key before every ticket on the team: the top of any column."""
    first = session.exec(
        select(Ticket.rank)
        .where(Ticket.team_id == team_id, Ticket.rank != "")
        .order_by(rank_order(session))
        .limit(1)
    ).first()
    return key_between(None, first)


def rerank_team(session: Session, team_id: int) -> None:
    """Number the team's tickets afresh, keeping their current order.

    For repair only. Two tickets can end up with the same key -- an import
    racing a drag, a row written by hand -- and then no key fits between
    them; renumbering the whole team (a few thousand short keys) is cheap
    and makes every gap usable again.
    """
    tickets = session.exec(
        select(Ticket)
        .where(Ticket.team_id == team_id)
        .order_by(rank_order(session), Ticket.number.desc())
    ).all()
    for ticket, key in zip(tickets, keys_in_order()):
        ticket.rank = key
        session.add(ticket)
    session.flush()


def rank_between(
    session: Session, above: Optional[Ticket], below: Optional[Ticket]
) -> str:
    """A key between two neighbours, renumbering first if they are tied."""
    a = above.rank if above else None
    b = below.rank if below else None
    try:
        return key_between(a, b)
    except RankError:
        team_id = (above or below).team_id
        rerank_team(session, team_id)
        return key_between(above.rank if above else None, below.rank if below else None)


def neighbour_or_404(session: Session, ticket: Ticket, neighbour_id: Optional[int]):
    """A card the moved one was dropped next to -- on the same team, and not
    the card itself."""
    if neighbour_id is None:
        return None
    neighbour = session.get(Ticket, neighbour_id)
    if neighbour is None or neighbour.team_id != ticket.team_id:
        raise api_error(
            status_code=404,
            code=ErrorCode.ticket_not_found,
            detail="The ticket it was dropped next to is not on this team",
        )
    if neighbour.id == ticket.id:
        raise api_error(
            status_code=400,
            code=ErrorCode.rank_neighbour_is_self,
            detail="A ticket cannot be placed next to itself",
        )
    return neighbour
