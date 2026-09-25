"""The project-history migration, against a database with issues in projects
(issue #64).

What matters is the backfill: every issue already in a project gets one event
saying so, stamped at upgrade time, so an existing epic's burnup starts on
upgrade day at its real scope instead of at the first issue moved afterwards.
The Postgres half -- adding the enum value, which has to be committed before
the backfill can use it -- was run by hand against postgres:16-alpine,
including a downgrade and a second upgrade.
"""

import sqlite3
from datetime import datetime, timezone

import pytest
from alembic import command
from alembic.config import Config

BEFORE = "3f1a9c7e2b64"
AFTER = "a4d8e2c6f913"


def _config(db_path) -> Config:
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return config


@pytest.fixture
def upgraded(tmp_path):
    """Two issues in a project, one in none, and one older event of each kind."""
    db_path = tmp_path / "events.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)

    connection = sqlite3.connect(db_path)
    stamp = "'2026-01-01 00:00:00'"
    connection.execute(
        "INSERT INTO team (id, name, key, next_issue_number, next_cycle_number,"
        f" created_at) VALUES (1, 'Engineering', 'ENG', 4, 1, {stamp})"
    )
    connection.execute(
        "INSERT INTO user (id, email, username, hashed_password, full_name,"
        " avatar_color, is_active, is_site_admin, token_version,"
        " email_notifications, created_at) VALUES (1, 'a@b.c', 'a', 'x', 'A',"
        f" '#6366f1', 1, 0, 0, 1, {stamp})"
    )
    connection.execute(
        "INSERT INTO project (id, team_id, name, color, state, archived,"
        f" created_at) VALUES (5, 1, 'Platform', '#6366f1', 'planned', 0, {stamp})"
    )
    connection.execute(
        "INSERT INTO workflowstatus (id, team_id, name, category, position,"
        f" color, created_at) VALUES (1, 1, 'Todo', 'unstarted', 0, '#888', {stamp})"
    )
    for number, project in ((1, 5), (2, 5), (3, None)):
        connection.execute(
            "INSERT INTO issue (id, team_id, project_id, number, title, status_id,"
            " priority, creator_id, created_at, updated_at) VALUES"
            f" (?, 1, ?, ?, 'Work', 1, 'no_priority', 1, {stamp}, {stamp})",
            (number, project, number),
        )
    connection.execute(
        "INSERT INTO issueevent (issue_id, team_id, field, old_value, new_value,"
        f" created_at) VALUES (1, 1, 'status', NULL, 'unstarted', {stamp})"
    )
    connection.commit()
    connection.close()

    before_upgrade = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
    command.upgrade(config, AFTER)
    return db_path, config, before_upgrade


def _project_events(db_path):
    connection = sqlite3.connect(db_path)
    rows = connection.execute(
        "SELECT issue_id, team_id, old_value, new_value, actor_id, created_at"
        " FROM issueevent WHERE field = 'project' ORDER BY issue_id"
    ).fetchall()
    connection.close()
    return rows


def test_every_issue_in_a_project_gets_one_event(upgraded):
    db_path, _, _ = upgraded
    rows = _project_events(db_path)
    # Issue 3 is in no project, so it gets nothing.
    assert [row[:5] for row in rows] == [
        (1, 1, None, "5", None),
        (2, 1, None, "5", None),
    ]


def test_the_backfill_is_stamped_at_upgrade_time_not_invented(upgraded):
    """Not at the issue's creation: nothing recorded when it joined."""
    db_path, _, before_upgrade = upgraded
    for row in _project_events(db_path):
        stamped = datetime.fromisoformat(str(row[5])).replace(microsecond=0)
        assert stamped >= before_upgrade


def test_the_older_history_is_left_alone(upgraded):
    db_path, _, _ = upgraded
    connection = sqlite3.connect(db_path)
    count = connection.execute(
        "SELECT COUNT(*) FROM issueevent WHERE field = 'status'"
    ).fetchone()[0]
    connection.close()
    assert count == 1


def test_a_rollback_removes_only_the_project_events(upgraded):
    db_path, config, _ = upgraded
    command.downgrade(config, BEFORE)
    assert _project_events(db_path) == []
    connection = sqlite3.connect(db_path)
    remaining = connection.execute("SELECT field FROM issueevent").fetchall()
    connection.close()
    assert remaining == [("status",)]
