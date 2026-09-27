"""Relationships between tickets.

One row per relationship, read from both ends. Storing `A blocks B` and
separately `B blocked by A` would let the two halves drift apart the moment a
delete missed one of them; deriving the inverse at read time means they cannot.
"""

from fastapi import status as http_status
from sqlmodel import Session, select

from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.models.links import (
    TicketLinkCreate,
    TicketLinkRead,
    TicketLinks,
    LinkedTicket,
)
from lib_softtrack.tables import (
    DIRECTED_LINK_TYPES,
    Ticket,
    TicketLink,
    TicketLinkType,
    Team,
    User,
    WorkflowStatus,
)
from lib_softtrack.statuses import RESOLVED, in_category
from lib_softtrack.teams import require_team_member, require_team_writer
from lib_utils.errors import ErrorCode, api_error

#: A ticket whose status means one of these cannot block anything -- it is
#: finished. Used to decide whether a card is *currently* blocked, as opposed
#: to having ever had a blocker. Categories, so a team's own "Shipped" column
#: counts without anyone having to list it here.
RESOLVED_STATUSES = RESOLVED

#: How each stored type reads from the source end and from the target end.
_RELATION_NAMES: dict[TicketLinkType, tuple[str, str]] = {
    TicketLinkType.blocks: ("blocks", "blocked_by"),
    TicketLinkType.duplicates: ("duplicates", "duplicated_by"),
    TicketLinkType.relates_to: ("relates_to", "relates_to"),
}


def _ticket_or_404(session: Session, ticket_id: int) -> Ticket:
    ticket = session.get(Ticket, ticket_id)
    if ticket is None:
        raise api_error(
            status_code=404, code=ErrorCode.ticket_not_found, detail="Ticket not found"
        )
    return ticket


def _linked_ticket(
    ticket: Ticket, teams: dict[int, Team], statuses: dict[int, WorkflowStatus]
) -> LinkedTicket:
    return LinkedTicket(
        id=ticket.id,
        team_key=teams[ticket.team_id].key,
        number=ticket.number,
        identifier=f"{teams[ticket.team_id].key}-{ticket.number}",
        title=ticket.title,
        status=StatusRead.model_validate(statuses[ticket.status_id]),
        priority=ticket.priority,
    )


def create_link(
    session: Session, current_user: User, ticket_id: int, payload: TicketLinkCreate
) -> TicketLinkRead:
    source = _ticket_or_404(session, ticket_id)
    target = _ticket_or_404(session, payload.target_id)

    # Membership of *both* teams. Linking across teams is useful, but it must
    # not become a way to learn that a ticket exists in a team you are not in.
    # Write access to both, too (#104): the link shows on the target ticket as
    # well, so a guest of the target team would otherwise be editing it.
    require_team_writer(source.team_id, current_user, session)
    require_team_writer(target.team_id, current_user, session)

    if source.id == target.id:
        raise api_error(
            status_code=400,
            code=ErrorCode.link_to_self,
            detail="A ticket cannot be linked to itself.",
        )

    if _link_exists(session, source.id, target.id, payload.type):
        raise api_error(
            status_code=409,
            code=ErrorCode.link_exists,
            detail="These tickets are already linked that way.",
        )

    if payload.type is TicketLinkType.relates_to:
        # Symmetric: B relates to A is the same fact as A relates to B, so the
        # mirror is a duplicate rather than a second relationship.
        if _link_exists(session, target.id, source.id, payload.type):
            raise api_error(
                status_code=409,
                code=ErrorCode.link_exists,
                detail="These tickets are already related.",
            )
    elif payload.type in DIRECTED_LINK_TYPES:
        # Direction means something here, so the pair cannot point both ways:
        # "A blocks B and B blocks A" describes work that can never start.
        if _link_exists(session, target.id, source.id, payload.type):
            forward, inverse = _RELATION_NAMES[payload.type]
            raise api_error(
                status_code=409,
                code=ErrorCode.link_contradicts,
                detail=(
                    f"That would contradict an existing link: this ticket is "
                    f"already {inverse.replace('_', ' ')} that one."
                ),
            )

    link = TicketLink(
        source_id=source.id,
        target_id=target.id,
        type=payload.type,
        created_by_id=current_user.id,
    )
    session.add(link)
    session.commit()
    session.refresh(link)

    teams = _teams_for(session, [target])
    statuses = _statuses_for(session, [target])
    forward, _ = _RELATION_NAMES[payload.type]
    return TicketLinkRead(
        id=link.id,
        relation=forward,
        ticket=_linked_ticket(target, teams, statuses),
        created_at=link.created_at,
    )


def delete_link(
    session: Session, current_user: User, ticket_id: int, link_id: int
) -> None:
    ticket = _ticket_or_404(session, ticket_id)
    require_team_member(ticket.team_id, current_user, session)

    link = session.get(TicketLink, link_id)
    # Either end may remove the relationship -- it belongs to both tickets, and
    # requiring the author to undo it would strand links when people leave.
    if link is None or ticket.id not in (link.source_id, link.target_id):
        raise api_error(
            status_code=404,
            code=ErrorCode.link_not_found,
            detail="Link not found on this ticket",
        )

    session.delete(link)
    session.commit()


def list_links(session: Session, current_user: User, ticket_id: int) -> TicketLinks:
    ticket = _ticket_or_404(session, ticket_id)
    require_team_member(ticket.team_id, current_user, session)

    outgoing = session.exec(
        select(TicketLink).where(TicketLink.source_id == ticket.id)
    ).all()
    incoming = session.exec(
        select(TicketLink).where(TicketLink.target_id == ticket.id)
    ).all()

    other_ids = {link.target_id for link in outgoing} | {
        link.source_id for link in incoming
    }
    tickets = {
        other.id: other
        for other in session.exec(select(Ticket).where(Ticket.id.in_(other_ids))).all()
    }
    teams = _teams_for(session, tickets.values())
    statuses = _statuses_for(session, tickets.values())

    links = TicketLinks()
    for link, other_id, end in [
        *((link, link.target_id, 0) for link in outgoing),
        *((link, link.source_id, 1) for link in incoming),
    ]:
        other = tickets.get(other_id)
        if other is None:
            continue
        relation = _RELATION_NAMES[link.type][end]
        getattr(links, relation).append(
            TicketLinkRead(
                id=link.id,
                relation=relation,
                ticket=_linked_ticket(other, teams, statuses),
                created_at=link.created_at,
            )
        )

    return links


def open_blocker_counts(session: Session, ticket_ids: list[int]) -> dict[int, int]:
    """How many unresolved tickets block each of `ticket_ids`.

    One query for the whole page, so adding this to the ticket list does not
    reintroduce the per-ticket queries removed in #10. Blockers that are done
    or cancelled do not count: a ticket is blocked by work still outstanding,
    not by work that once blocked it.
    """
    if not ticket_ids:
        return {}

    rows = session.exec(
        select(TicketLink.target_id)
        .join(Ticket, Ticket.id == TicketLink.source_id)
        .where(
            TicketLink.type == TicketLinkType.blocks,
            TicketLink.target_id.in_(ticket_ids),
            ~in_category(*RESOLVED_STATUSES),
        )
    ).all()

    counts: dict[int, int] = {}
    for target_id in rows:
        counts[target_id] = counts.get(target_id, 0) + 1
    return counts


def _link_exists(
    session: Session, source_id: int, target_id: int, type_: TicketLinkType
) -> bool:
    return (
        session.exec(
            select(TicketLink).where(
                TicketLink.source_id == source_id,
                TicketLink.target_id == target_id,
                TicketLink.type == type_,
            )
        ).first()
        is not None
    )


def _teams_for(session: Session, tickets) -> dict[int, Team]:
    team_ids = {ticket.team_id for ticket in tickets}
    if not team_ids:
        return {}
    return {
        team.id: team
        for team in session.exec(select(Team).where(Team.id.in_(team_ids))).all()
    }


def _statuses_for(session: Session, tickets) -> dict[int, WorkflowStatus]:
    """The status rows a set of tickets points at, in one query.

    Links reach across teams, so these can come from several workflows -- and
    the panel renders each one with its own team's colour and name.
    """
    status_ids = {ticket.status_id for ticket in tickets}
    if not status_ids:
        return {}
    return {
        status.id: status
        for status in session.exec(
            select(WorkflowStatus).where(WorkflowStatus.id.in_(status_ids))
        ).all()
    }
