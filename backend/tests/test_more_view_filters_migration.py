"""The migration that gives saved views the #261 filters, against a database
with a view in it: the view opens on what it always did, and the downgrade
gives the columns back. Postgres was checked by hand, up, down and up again.
"""

import json
import sqlite3

from alembic import command

from tests.test_view_filter_lists_migration import _config

BEFORE = "a7c2e9d4f160"
AFTER = "c3f81d5a2e67"
NEW = (
    "assignee_me",
    "creator_ids",
    "creator_me",
    "creator_exclude",
    "watching",
    "updated",
    "updated_from",
    "updated_to",
    "created",
    "created_from",
    "created_to",
    "has_no",
)


def _columns(db_path):
    connection = sqlite3.connect(db_path)
    names = {row[1] for row in connection.execute("PRAGMA table_info(savedview)")}
    connection.close()
    return names


def test_an_existing_view_asks_nothing_new_and_the_downgrade_drops_it(tmp_path):
    db_path = tmp_path / "more.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    connection = sqlite3.connect(db_path)
    connection.execute(
        "INSERT INTO savedview (team_id, name, owner_id, is_shared, unassigned,"
        " group_by, created_at, updated_at) VALUES (1, 'Mine', 1, 1, 0,"
        " 'status', '2026-01-01 00:00:00', '2026-01-01 00:00:00')"
    )
    connection.commit()
    connection.close()

    command.upgrade(config, AFTER)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    row = dict(connection.execute("SELECT * FROM savedview").fetchone())
    connection.close()
    assert json.loads(row["creator_ids"]) == []
    assert json.loads(row["has_no"]) == []
    assert not row["assignee_me"] and not row["creator_me"] and not row["watching"]
    assert row["updated"] is None and row["created_to"] is None

    command.downgrade(config, BEFORE)
    assert not set(NEW) & _columns(db_path)
