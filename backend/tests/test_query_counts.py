"""A ceiling on query counts for the ticket list.

Asserting an exact number would break on any incidental change, so this asserts
the property that actually matters: the cost does not grow with the page size.
Before soft-track#10 a page of 50 cost ~58 queries and a page of 200 cost ~208,
because each ticket fetched its own label links.
"""

import pytest
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from lib_softtrack.tickets import list_tickets
from lib_softtrack.statuses import create_default_statuses
from lib_softtrack.tables import (
    Ticket,
    TicketLabelLink,
    Label,
    Team,
    TeamMember,
    TeamRole,
    User,
)


def _seeded_engine(ticket_count: int):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        users = [
            User(
                email=f"u{k}@softtrack.dev",
                username=f"u{k}",
                hashed_password="x",
                full_name=f"U{k}",
            )
            for k in range(5)  # several assignees, so the identity map cannot hide it
        ]
        for user in users:
            session.add(user)
        session.commit()
        for user in users:
            session.refresh(user)

        team = Team(name="Engineering", key="ENG")
        session.add(team)
        session.commit()
        session.refresh(team)
        session.add(
            TeamMember(team_id=team.id, user_id=users[0].id, role=TeamRole.admin)
        )
        session.commit()

        labels = [
            Label(team_id=team.id, name=f"L{i}", color="#000000") for i in range(3)
        ]
        for label in labels:
            session.add(label)
        session.commit()
        for label in labels:
            session.refresh(label)

        # This fixture writes rows directly rather than going through the
        # API, so it has to create the workflow `create_team` would have.
        statuses = create_default_statuses(session, team.id)
        session.commit()

        for i in range(ticket_count):
            ticket = Ticket(
                team_id=team.id,
                number=i + 1,
                title=f"ticket {i}",
                status_id=statuses[i % len(statuses)].id,
                creator_id=users[i % 5].id,
                assignee_id=users[(i + 1) % 5].id,
            )
            session.add(ticket)
            session.commit()
            session.refresh(ticket)
            for label in labels:
                session.add(TicketLabelLink(ticket_id=ticket.id, label_id=label.id))
            session.commit()
        # ids, not ORM objects: instances detach when this session closes
        return engine, users[0].id, team.id


def _queries_to_list(ticket_count: int) -> int:
    engine, actor_id, team_id = _seeded_engine(ticket_count)
    counted: list[str] = []

    def _record(conn, cursor, statement, *args):
        counted.append(statement)

    with Session(engine) as session:
        actor = session.get(User, actor_id)  # load before counting starts
        event.listen(engine, "before_cursor_execute", _record)
        page = list_tickets(session, actor, team_id, limit=200)
        event.remove(engine, "before_cursor_execute", _record)
        assert len(page.items) == ticket_count
    return len(counted)


def test_listing_tickets_does_not_scale_queries_with_page_size():
    small = _queries_to_list(5)
    large = _queries_to_list(60)
    assert small == large, (
        f"query count grew with the page: {small} for 5 tickets, {large} for 60. "
        "Something in the list path is querying per ticket again."
    )


#: Raised from 10 to 11 when statuses became rows (soft-track#22): a page of
#: tickets now loads the status rows it points at. One query for the page, not
#: one per ticket -- which is what the test above actually guards.
_CEILING = 11


@pytest.mark.parametrize("ticket_count", [5, 60])
def test_the_ticket_list_stays_under_a_query_ceiling(ticket_count):
    assert _queries_to_list(ticket_count) <= _CEILING
