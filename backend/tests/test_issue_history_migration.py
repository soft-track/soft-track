"""The history migration for issue #81, against a table that already has
events in it.

What matters is which existing rows it marks as opening values -- those the
Activity feed will hide -- because unlike rows written afterwards, these can
only be recognised by their shape. The Postgres half (the enum values, and
the interval arithmetic in the backfill) was run by hand against
postgres:16-alpine.
"""

import sqlite3

import pytest
from alembic import command
from alembic.config import Config

BEFORE = "a4d8e2c6f913"
AFTER = "b5e1f7a2c830"


def _config(db_path) -> Config:
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return config


#: (id, field, old, new, actor, created_at) -- one issue's history.
EVENTS = [
    # The creation burst: opening values.
    (1, "status", None, "backlog", 1, "2026-01-01 09:00:00.000100"),
    (2, "estimate", None, "3", 1, "2026-01-01 09:00:00.000200"),
    # A real change, from nothing, a day later: must stay visible.
    (3, "cycle", None, "7", 1, "2026-01-02 09:00:00"),
    # A real change with an old value: visible, whatever its timing.
    (4, "status", "backlog", "done", 1, "2026-01-03 09:00:00"),
    # What a4d8e2c6f913 wrote at upgrade time: where the issue stood.
    (5, "project", None, "5", None, "2026-09-25 12:00:00"),
]


@pytest.fixture
def upgraded(tmp_path):
    db_path = tmp_path / "history.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)

    connection = sqlite3.connect(db_path)
    stamp = "'2026-01-01 00:00:00'"
    connection.execute(
        "INSERT INTO team (id, name, key, next_issue_number, next_cycle_number,"
        f" created_at) VALUES (1, 'Engineering', 'ENG', 2, 1, {stamp})"
    )
    connection.execute(
        "INSERT INTO user (id, email, username, hashed_password, full_name,"
        " avatar_color, is_active, is_site_admin, token_version,"
        " email_notifications, created_at) VALUES (1, 'a@b.c', 'a', 'x', 'A',"
        f" '#6366f1', 1, 0, 0, 1, {stamp})"
    )
    connection.execute(
        "INSERT INTO workflowstatus (id, team_id, name, category, position,"
        f" color, created_at) VALUES (1, 1, 'Todo', 'unstarted', 0, '#888', {stamp})"
    )
    connection.execute(
        "INSERT INTO issue (id, team_id, number, title, status_id, priority,"
        f" creator_id, created_at, updated_at) VALUES (1, 1, 1, 'Work', 1,"
        f" 'no_priority', 1, {stamp}, {stamp})"
    )
    connection.executemany(
        "INSERT INTO issueevent (id, issue_id, team_id, field, old_value,"
        " new_value, actor_id, created_at) VALUES (?, 1, 1, ?, ?, ?, ?, ?)",
        EVENTS,
    )
    connection.commit()
    connection.close()

    command.upgrade(config, AFTER)
    return db_path, config


def _opening(db_path) -> dict[int, bool]:
    connection = sqlite3.connect(db_path)
    rows = connection.execute("SELECT id, opening FROM issueevent").fetchall()
    connection.close()
    return {event_id: bool(flag) for event_id, flag in rows}


def test_the_creation_burst_and_the_project_snapshot_are_marked_opening(upgraded):
    db_path, _ = upgraded
    assert _opening(db_path) == {1: True, 2: True, 3: False, 4: False, 5: True}


def test_the_default_does_not_outlive_the_migration(upgraded):
    db_path, _ = upgraded
    connection = sqlite3.connect(db_path)
    defaults = {
        row[1]: row[4] for row in connection.execute("PRAGMA table_info(issueevent)")
    }
    connection.close()
    assert defaults["opening"] is None


def test_a_rollback_drops_the_column_and_keeps_the_history(upgraded):
    db_path, config = upgraded
    connection = sqlite3.connect(db_path)
    connection.execute(
        "INSERT INTO issueevent (issue_id, team_id, field, old_value, new_value,"
        " actor_id, created_at, opening) VALUES (1, 1, 'priority', 'low', 'high',"
        " 1, '2026-09-26 00:00:00', 0)"
    )
    connection.commit()
    connection.close()

    command.downgrade(config, BEFORE)
    connection = sqlite3.connect(db_path)
    columns = {row[1] for row in connection.execute("PRAGMA table_info(issueevent)")}
    ids = sorted(row[0] for row in connection.execute("SELECT id FROM issueevent"))
    connection.close()
    assert "opening" not in columns
    # The priority change goes (its field will not exist); the rest stays.
    assert ids == [1, 2, 3, 4, 5]
