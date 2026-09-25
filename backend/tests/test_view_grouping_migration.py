"""The saved-view grouping migration, against a database with a view in it
(issue #63).

The risk is the existing row: `group_by` arrives NOT NULL, so a migration
without a server default -- or one that dropped it in the same SQLite batch
that added the column -- fails on any install where somebody ever saved a
view. The Postgres half, where `issuegrouping` has to be created before
`add_column` can use it, follows d8c2a6f41e93, which was checked by hand.
"""

import sqlite3

import pytest
from alembic import command
from alembic.config import Config

BEFORE = "d8c2a6f41e93"
AFTER = "3f1a9c7e2b64"


def _config(db_path) -> Config:
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return config


@pytest.fixture
def upgraded(tmp_path):
    """A database at the previous revision, holding a team with a saved view."""
    db_path = tmp_path / "grouping.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)

    connection = sqlite3.connect(db_path)
    connection.execute(
        "INSERT INTO team (id, name, key, next_issue_number, next_cycle_number,"
        " created_at) VALUES (1, 'Engineering', 'ENG', 1, 1,"
        " '2026-01-01 00:00:00')"
    )
    connection.execute(
        "INSERT INTO user (id, email, username, hashed_password, full_name,"
        " avatar_color, is_active, is_site_admin, token_version,"
        " email_notifications, created_at) VALUES (1, 'a@b.c', 'a', 'x', 'A',"
        " '#6366f1', 1, 0, 0, 1, '2026-01-01 00:00:00')"
    )
    connection.execute(
        "INSERT INTO savedview (team_id, name, owner_id, is_shared, unassigned,"
        " priority, created_at, updated_at) VALUES (1, 'Urgent', 1, 1, 0,"
        " 'urgent', '2026-01-01 00:00:00', '2026-01-01 00:00:00')"
    )
    connection.commit()
    connection.close()

    command.upgrade(config, AFTER)
    return db_path, config


def _views(db_path):
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    rows = [dict(row) for row in connection.execute("SELECT * FROM savedview")]
    connection.close()
    return rows


def test_an_existing_view_comes_out_grouped_by_status(upgraded):
    """What it showed before the column existed."""
    db_path, _ = upgraded
    [view] = _views(db_path)
    assert view["group_by"] == "status"
    # The rebuild kept the rest of the row.
    assert (view["name"], view["priority"]) == ("Urgent", "urgent")


def test_the_default_does_not_outlive_the_migration(upgraded):
    """The model always sends a value; a lingering server default would hide
    a code path that forgot to."""
    db_path, _ = upgraded
    connection = sqlite3.connect(db_path)
    columns = {
        row[1]: row[4] for row in connection.execute("PRAGMA table_info(savedview)")
    }
    connection.close()
    assert columns["group_by"] is None


def test_a_rollback_keeps_the_view(upgraded):
    db_path, config = upgraded
    command.downgrade(config, BEFORE)
    [view] = _views(db_path)
    assert "group_by" not in view
    assert view["name"] == "Urgent"
