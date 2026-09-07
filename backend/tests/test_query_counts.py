"""A ceiling on query counts for the issue list.

Asserting an exact number would break on any incidental change, so this asserts
the property that actually matters: the cost does not grow with the page size.
Before soft-track#10 a page of 50 cost ~58 queries and a page of 200 cost ~208,
because each issue fetched its own label links.
"""

import pytest
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from lib_softtrack.issues import list_issues
from lib_softtrack.tables import (
    Issue,
    IssueLabelLink,
    Label,
    Team,
    TeamMember,
    TeamRole,
    User,
)


def _seeded_engine(issue_count: int):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        users = [
            User(email=f"u{k}@softtrack.dev", hashed_password="x", full_name=f"U{k}")
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

        for i in range(issue_count):
            issue = Issue(
                team_id=team.id,
                number=i + 1,
                title=f"issue {i}",
                creator_id=users[i % 5].id,
                assignee_id=users[(i + 1) % 5].id,
            )
            session.add(issue)
            session.commit()
            session.refresh(issue)
            for label in labels:
                session.add(IssueLabelLink(issue_id=issue.id, label_id=label.id))
            session.commit()
        # ids, not ORM objects: instances detach when this session closes
        return engine, users[0].id, team.id


def _queries_to_list(issue_count: int) -> int:
    engine, actor_id, team_id = _seeded_engine(issue_count)
    counted: list[str] = []

    def _record(conn, cursor, statement, *args):
        counted.append(statement)

    with Session(engine) as session:
        actor = session.get(User, actor_id)  # load before counting starts
        event.listen(engine, "before_cursor_execute", _record)
        page = list_issues(session, actor, team_id, limit=200)
        event.remove(engine, "before_cursor_execute", _record)
        assert len(page.items) == issue_count
    return len(counted)


def test_listing_issues_does_not_scale_queries_with_page_size():
    small = _queries_to_list(5)
    large = _queries_to_list(60)
    assert small == large, (
        f"query count grew with the page: {small} for 5 issues, {large} for 60. "
        "Something in the list path is querying per issue again."
    )


@pytest.mark.parametrize("issue_count", [5, 60])
def test_the_issue_list_stays_under_a_query_ceiling(issue_count):
    assert _queries_to_list(issue_count) <= 10
