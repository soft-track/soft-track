"""The user-management migration, run against a real database with rows in it.

The rest of the suite builds its schema with `SQLModel.metadata.create_all`, so
nothing else ever exercises the migration -- and the migration is the only part
of this feature that runs against data somebody already cares about. It gets
its own file-backed database because SQLite's batch mode rebuilds tables, which
an in-memory database on a StaticPool does not survive cleanly.
"""

import sqlite3

import pytest
from alembic import command
from alembic.config import Config

BEFORE = "4fabaf161db7"
AFTER = "b7d3e91a5c04"


def _config(db_path) -> Config:
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    # Honoured because env.py only falls back to settings.database_url when
    # nothing has been set -- otherwise this would run against the real one.
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return config


@pytest.fixture
def upgraded(tmp_path):
    """A database at the previous revision, holding three awkward accounts."""
    db_path = tmp_path / "migration.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)

    connection = sqlite3.connect(db_path)
    connection.executemany(
        "INSERT INTO user (email, hashed_password, full_name, avatar_color,"
        " created_at) VALUES (?, 'x', ?, '#6366f1', '2026-01-01 00:00:00')",
        [
            ("sam@a.com", "Sam A"),
            ("sam@b.com", "Sam B"),
            ("Weird Name+tag@c.com", "Weird Name"),
        ],
    )
    connection.commit()
    connection.close()

    command.upgrade(config, AFTER)
    return db_path, config


def _rows(db_path):
    connection = sqlite3.connect(db_path)
    rows = connection.execute(
        "SELECT id, email, username, is_active, is_site_admin, token_version"
        " FROM user ORDER BY id"
    ).fetchall()
    connection.close()
    return rows


def test_usernames_are_derived_from_the_addresses(upgraded):
    db_path, _ = upgraded
    assert [row[2] for row in _rows(db_path)] == ["sam", "sam2", "weird-name-tag"]


def test_every_existing_account_stays_active_at_version_zero(upgraded):
    db_path, _ = upgraded
    for row in _rows(db_path):
        assert row[3] == 1, "existing accounts must not be switched off"
        # Tokens already in the wild carry no `ver` and are read as 0, so the
        # upgrade itself signs nobody out.
        assert row[5] == 0


def test_the_oldest_account_becomes_the_site_admin(upgraded):
    db_path, _ = upgraded
    rows = _rows(db_path)
    assert [row[4] for row in rows] == [1, 0, 0]


def test_the_username_index_is_unique(upgraded):
    db_path, _ = upgraded
    connection = sqlite3.connect(db_path)
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            "INSERT INTO user (email, username, hashed_password, full_name,"
            " avatar_color, is_active, is_site_admin, token_version, created_at)"
            " VALUES ('new@c.com', 'sam', 'x', 'N', '#6366f1', 1, 0, 0,"
            " '2026-01-01 00:00:00')"
        )
    connection.close()


def test_the_invite_table_is_created(upgraded):
    db_path, _ = upgraded
    connection = sqlite3.connect(db_path)
    names = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    connection.close()
    assert "teaminvite" in names


def test_upgrading_an_empty_database_works(tmp_path):
    """No rows means no backfill and no site admin -- and no error either."""
    config = _config(tmp_path / "empty.db")
    command.upgrade(config, AFTER)
    assert _rows(tmp_path / "empty.db") == []


def test_the_downgrade_undoes_it(upgraded):
    db_path, config = upgraded
    command.downgrade(config, BEFORE)

    connection = sqlite3.connect(db_path)
    columns = {
        row[1] for row in connection.execute("PRAGMA table_info(user)").fetchall()
    }
    tables = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    emails = [
        row[0] for row in connection.execute("SELECT email FROM user ORDER BY id")
    ]
    connection.close()

    assert "username" not in columns
    assert "is_site_admin" not in columns
    assert "teaminvite" not in tables
    # The accounts themselves survive a rollback.
    assert emails == ["sam@a.com", "sam@b.com", "Weird Name+tag@c.com"]
