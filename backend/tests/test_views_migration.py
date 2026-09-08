"""The saved-views migration, run against a database that already has rows.

Note what this file cannot cover. The interesting failure in this migration is
Postgres-only -- `savedview.status` reuses the `issuestatus` enum type, and
what autogenerate emitted tried to create it a second time. See the helper's
docstring in the revision; it was verified by hand against postgres:16-alpine,
because the suite runs on SQLite, where enums are VARCHAR and the whole class
of problem does not exist.

What is left to check here is the shape: the tables arrive, the team column
arrives nullable, and a rollback leaves the teams alone.
"""

import sqlite3

import pytest
from alembic import command
from alembic.config import Config

BEFORE = "75b841119c61"
AFTER = "816a5f43eb02"


def _config(db_path) -> Config:
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return config


@pytest.fixture
def upgraded(tmp_path):
    """A database at the previous revision, holding a team."""
    db_path = tmp_path / "views.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)

    connection = sqlite3.connect(db_path)
    connection.execute(
        "INSERT INTO team (name, key, next_issue_number, next_cycle_number,"
        " created_at) VALUES ('Engineering', 'ENG', 1, 1, '2026-01-01 00:00:00')"
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
    assert {"savedview", "userdefaultview"} <= _tables(db_path)


def test_existing_teams_get_a_null_default(upgraded):
    """Nullable, so no server default and no backfill: a team with no saved
    views has no default, which is right for every team that already exists."""
    db_path, _ = upgraded
    connection = sqlite3.connect(db_path)
    rows = connection.execute("SELECT key, default_view_id FROM team").fetchall()
    connection.close()
    assert rows == [("ENG", None)]


def test_upgrading_an_empty_database_works(tmp_path):
    config = _config(tmp_path / "empty.db")
    command.upgrade(config, AFTER)
    assert {"savedview", "userdefaultview"} <= _tables(tmp_path / "empty.db")


def test_the_downgrade_undoes_it(upgraded):
    db_path, config = upgraded
    command.downgrade(config, BEFORE)

    connection = sqlite3.connect(db_path)
    columns = {row[1] for row in connection.execute("PRAGMA table_info(team)")}
    keys = [row[0] for row in connection.execute("SELECT key FROM team")]
    connection.close()

    assert "default_view_id" not in columns
    assert not {"savedview", "userdefaultview"} & _tables(db_path)
    # The teams themselves survive a rollback.
    assert keys == ["ENG"]
