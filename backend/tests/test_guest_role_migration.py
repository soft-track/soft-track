"""The guest-role migration (#104), against a database with people in it.

The upgrade is a no-op on SQLite and is here to prove it: a guest row written
after it must round-trip through the ORM. The downgrade is the part that
touches data -- it removes guests rather than promoting them -- so that is
what the rest of this file pins down. The Postgres half (`ALTER TYPE ... ADD
VALUE`) was checked by hand against postgres:16-alpine, including running
this revision alone against a database already at the previous one.
"""

import sqlite3

import pytest
from alembic import command
from alembic.config import Config

BEFORE = "3e8a0c2f5b69"
AFTER = "8c4e1a7d2f93"


def _config(db_path) -> Config:
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return config


@pytest.fixture
def upgraded(tmp_path):
    """A team with an admin and a member, upgraded, and then given a guest."""
    db_path = tmp_path / "guest.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)

    connection = sqlite3.connect(db_path)
    connection.execute(
        "INSERT INTO team (id, name, key, next_issue_number, next_cycle_number,"
        " created_at) VALUES (1, 'Engineering', 'ENG', 1, 1,"
        " '2026-01-01 00:00:00')"
    )
    for user_id in (1, 2, 3):
        connection.execute(
            "INSERT INTO user (id, email, username, hashed_password, full_name,"
            " avatar_color, is_active, is_site_admin, token_version,"
            " email_notifications, created_at) VALUES (?, ?, ?, 'x', 'A',"
            " '#6366f1', 1, 0, 0, 1, '2026-01-01 00:00:00')",
            (user_id, f"u{user_id}@b.c", f"u{user_id}"),
        )
    connection.executemany(
        "INSERT INTO teammember (team_id, user_id, role, joined_at)"
        " VALUES (1, ?, ?, '2026-01-01 00:00:00')",
        [(1, "admin"), (2, "member")],
    )
    connection.commit()
    connection.close()

    command.upgrade(config, AFTER)

    connection = sqlite3.connect(db_path)
    connection.execute(
        "INSERT INTO teammember (team_id, user_id, role, joined_at)"
        " VALUES (1, 3, 'guest', '2026-01-01 00:00:00')"
    )
    connection.execute(
        "INSERT INTO teaminvite (team_id, email, role, token, invited_by_id,"
        " created_at, expires_at) VALUES (1, 'g@b.c', 'guest', 'tok-g', 1,"
        " '2026-01-01 00:00:00', '2099-01-01 00:00:00')"
    )
    connection.execute(
        "INSERT INTO teaminvite (team_id, email, role, token, invited_by_id,"
        " created_at, expires_at) VALUES (1, 'm@b.c', 'member', 'tok-m', 1,"
        " '2026-01-01 00:00:00', '2099-01-01 00:00:00')"
    )
    connection.commit()
    connection.close()
    return db_path, config


def _rows(db_path, sql):
    connection = sqlite3.connect(db_path)
    rows = connection.execute(sql).fetchall()
    connection.close()
    return rows


def test_a_guest_row_reads_back_through_the_orm(upgraded):
    """The column needed no change on SQLite -- this is the proof."""
    from sqlmodel import Session, create_engine, select

    from lib_softtrack.tables import TeamMember, TeamRole

    db_path, _ = upgraded
    engine = create_engine(f"sqlite:///{db_path}")
    with Session(engine) as session:
        roles = session.exec(select(TeamMember.role).order_by(TeamMember.user_id)).all()
    engine.dispose()
    assert roles == [TeamRole.admin, TeamRole.member, TeamRole.guest]


def test_downgrading_removes_guests_rather_than_promoting_them(upgraded):
    db_path, config = upgraded
    command.downgrade(config, BEFORE)

    assert _rows(db_path, "SELECT user_id, role FROM teammember ORDER BY user_id") == [
        (1, "admin"),
        (2, "member"),
    ]
    assert _rows(db_path, "SELECT email, role FROM teaminvite") == [("m@b.c", "member")]


def test_it_upgrades_again_after_a_downgrade(upgraded):
    _, config = upgraded
    command.downgrade(config, BEFORE)
    command.upgrade(config, AFTER)
