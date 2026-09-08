"""The notifications migration, run against a database that already has rows.

The rest of the suite builds its schema with `SQLModel.metadata.create_all`,
which never exercises an ALTER against existing data -- and `email_notifications`
is NOT NULL, so the accounts already in the table are exactly the case that
can fail. See tests/test_migrations.py for why this needs a file-backed
database rather than the in-memory one.
"""

import sqlite3

import pytest
from alembic import command
from alembic.config import Config

BEFORE = "b7d3e91a5c04"
AFTER = "75b841119c61"


def _config(db_path) -> Config:
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return config


@pytest.fixture
def upgraded(tmp_path):
    """A database at the previous revision, holding two accounts."""
    db_path = tmp_path / "notifications.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)

    connection = sqlite3.connect(db_path)
    connection.executemany(
        "INSERT INTO user (email, username, hashed_password, full_name,"
        " avatar_color, is_active, is_site_admin, token_version, created_at)"
        " VALUES (?, ?, 'x', ?, '#6366f1', 1, 0, 0, '2026-01-01 00:00:00')",
        [("sam@a.com", "sam", "Sam A"), ("kim@b.com", "kim", "Kim B")],
    )
    connection.commit()
    connection.close()

    command.upgrade(config, AFTER)
    return db_path, config


def _tables(db_path) -> set[str]:
    connection = sqlite3.connect(db_path)
    names = {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    connection.close()
    return names


def test_the_tables_are_created(upgraded):
    db_path, _ = upgraded
    assert {"issuewatch", "notification"} <= _tables(db_path)


def test_existing_accounts_are_opted_in(upgraded):
    """The column is NOT NULL, so the ALTER has to supply a value.

    Autogenerate emits neither the server default that makes it possible nor
    the follow-up that removes it, which is why this migration is hand-edited.
    """
    db_path, _ = upgraded
    connection = sqlite3.connect(db_path)
    rows = connection.execute(
        "SELECT email, email_notifications FROM user ORDER BY id"
    ).fetchall()
    connection.close()
    assert rows == [("sam@a.com", 1), ("kim@b.com", 1)]


def test_the_server_default_does_not_survive_the_migration(upgraded):
    """The application supplies the value from here on.

    Left in place it would be a second source of truth for the default, and
    the one the model does not know about.
    """
    db_path, _ = upgraded
    connection = sqlite3.connect(db_path)
    default = {row[1]: row[4] for row in connection.execute("PRAGMA table_info(user)")}[
        "email_notifications"
    ]
    connection.close()
    assert default is None


def test_upgrading_an_empty_database_works(tmp_path):
    config = _config(tmp_path / "empty.db")
    command.upgrade(config, AFTER)
    assert {"issuewatch", "notification"} <= _tables(tmp_path / "empty.db")


def test_the_downgrade_undoes_it(upgraded):
    db_path, config = upgraded
    command.downgrade(config, BEFORE)

    connection = sqlite3.connect(db_path)
    columns = {row[1] for row in connection.execute("PRAGMA table_info(user)")}
    emails = [
        row[0] for row in connection.execute("SELECT email FROM user ORDER BY id")
    ]
    connection.close()

    assert "email_notifications" not in columns
    assert not {"issuewatch", "notification"} & _tables(db_path)
    # The accounts themselves survive a rollback.
    assert emails == ["sam@a.com", "kim@b.com"]
