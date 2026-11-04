"""Moving an install's data out of SQLite (#361).

The suite has no Postgres, so the copy runs into a second SQLite database
with foreign keys enforced, the way Postgres always enforces them. What it
checks is what can go wrong on the way: the order the tables are filled in,
the links that point at a row made later, and a target that already holds
the demo data.
"""

import pytest
from sqlalchemy import create_engine, select, text
from sqlmodel import SQLModel

from move_to_postgres import copy_order, move, same_revision


@pytest.fixture
def install(client, team, auth):
    """An instance with the links that point forward: a person whose manager
    signed up after them, a ticket older than its parent, and a team whose
    default view came after it."""
    headers = team["headers"]
    team_id = team["team"]["id"]
    manager = auth("bob@example.com", "Bob")
    response = client.patch(
        f"/admin/users/{team['user']['id']}",
        json={"manager_id": manager["user"]["id"]},
        headers=headers,
    )
    assert response.status_code == 200, response.text

    child = client.post(
        f"/teams/{team_id}/tickets",
        json={"title": "Invoice PDF renders blank", "type": "bug"},
        headers=headers,
    ).json()
    parent = client.post(
        f"/teams/{team_id}/tickets", json={"title": "Customer portal"}, headers=headers
    ).json()
    response = client.patch(
        f"/tickets/{child['id']}", json={"parent_id": parent["id"]}, headers=headers
    )
    assert response.status_code == 200, response.text
    client.post(
        f"/tickets/{parent['id']}/comments",
        json={"body": "Blocked on it"},
        headers=headers,
    )
    client.post(
        f"/teams/{team_id}/sprints",
        json={"name": "Sprint 1", "starts_at": "2026-11-02", "ends_at": "2026-11-13"},
        headers=headers,
    )
    view = client.post(
        f"/teams/{team_id}/views",
        json={"name": "Bugs", "is_shared": True},
        headers=headers,
    ).json()
    response = client.put(
        f"/teams/{team_id}/default-view", json={"view_id": view["id"]}, headers=headers
    )
    assert response.status_code == 200, response.text
    return {"child": child, "parent": parent, "view": view, "manager": manager}


@pytest.fixture
def target(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'moved.db'}")
    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


def rows(engine, table):
    with engine.connect() as connection:
        return connection.execute(
            select(table).order_by(*table.primary_key.columns)
        ).all()


def test_every_row_arrives_as_it_was(session, install, target):
    source = session.get_bind()
    copied = move(source, target, out=lambda _: None)

    assert copied["ticket"] == 2
    assert copied["comment"] == 1
    for table in SQLModel.metadata.tables.values():
        assert rows(target, table) == rows(source, table), table.name


def test_the_links_that_point_forward_survive(session, install, target):
    move(session.get_bind(), target, out=lambda _: None)
    tables = SQLModel.metadata.tables

    with target.connect() as connection:
        ticket = tables["ticket"]
        parent_id = connection.execute(
            select(ticket.c.parent_id).where(ticket.c.id == install["child"]["id"])
        ).scalar_one()
        team = tables["team"]
        default_view_id = connection.execute(
            select(team.c.default_view_id)
        ).scalar_one()
        user = tables["user"]
        managers = connection.execute(select(user.c.manager_id)).scalars().all()

    assert parent_id == install["parent"]["id"]
    assert default_view_id == install["view"]["id"]
    assert install["manager"]["user"]["id"] in managers


def test_a_target_with_rows_is_left_alone_unless_told(
    session, install, target, tmp_path
):
    # Rows already there, the way seed.py leaves a fresh database.
    move(session.get_bind(), target, out=lambda _: None)

    with pytest.raises(SystemExit, match="--replace"):
        move(session.get_bind(), target, out=lambda _: None)

    copied = move(session.get_bind(), target, replace=True, out=lambda _: None)
    assert copied["ticket"] == 2


def test_every_table_has_an_order_with_nothing_required_left_waiting():
    tables, later = copy_order(SQLModel.metadata)

    assert len(tables) == len(SQLModel.metadata.tables)
    position = {table.name: index for index, table in enumerate(tables)}
    for table in tables:
        for fk in table.foreign_keys:
            if position[fk.column.table.name] >= position[table.name]:
                # Copied empty and filled in afterwards, which only works for
                # a column that may be empty.
                assert fk.parent.nullable, f"{table.name}.{fk.parent.name}"
                assert fk.parent.name in later[table.name]


def test_nothing_is_copied_between_two_revisions(tmp_path):
    def at(name, version):
        engine = create_engine(f"sqlite:///{tmp_path / name}")
        if version:
            with engine.begin() as connection:
                connection.execute(
                    text("CREATE TABLE alembic_version (version_num VARCHAR(32))")
                )
                connection.execute(
                    text(f"INSERT INTO alembic_version VALUES ('{version}')")
                )
        return engine

    assert (
        same_revision(at("a.db", "c2a1b3d45e67"), at("b.db", "c2a1b3d45e67"))
        == "c2a1b3d45e67"
    )
    with pytest.raises(SystemExit, match="different revisions"):
        same_revision(at("c.db", "c2a1b3d45e67"), at("d.db", "7a1c9e3b5d20"))
    # A Postgres database nothing has started against yet has no revision.
    with pytest.raises(SystemExit, match="different revisions"):
        same_revision(at("e.db", "c2a1b3d45e67"), at("f.db", None))
