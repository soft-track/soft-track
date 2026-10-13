"""The migration that makes a saved view's filters lists (#260), against a
database with views in it.

The promise is that every view opens on the tickets it always did: each
stored value becomes a list of one, an empty filter an empty list, and the
switches start off. Postgres was checked by hand, up, down and up again.
"""

import json
import sqlite3

import pytest
from alembic import command
from alembic.config import Config

BEFORE = "99fbfd7bcdb1"
AFTER = "a7c2e9d4f160"


def _config(db_path) -> Config:
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return config


def _views(db_path):
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    rows = {
        row["name"]: dict(row)
        for row in connection.execute("SELECT * FROM savedview ORDER BY id")
    }
    connection.close()
    return rows


@pytest.fixture
def upgraded(tmp_path):
    """Two views at the previous revision: one on every single-value filter,
    one on nobody assigned and nothing else. SQLite leaves foreign keys
    unchecked here, so the ids need no rows behind them."""
    db_path = tmp_path / "lists.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)

    connection = sqlite3.connect(db_path)
    connection.execute(
        "INSERT INTO savedview (team_id, name, owner_id, is_shared, status_id,"
        " priority, assignee_id, unassigned, label_id, group_by, type,"
        " created_at, updated_at) VALUES (1, 'Everything set', 1, 1, 5, 'high',"
        " 3, 0, 7, 'status', 'bug', '2026-01-01 00:00:00',"
        " '2026-01-01 00:00:00')"
    )
    connection.execute(
        "INSERT INTO savedview (team_id, name, owner_id, is_shared, unassigned,"
        " group_by, created_at, updated_at) VALUES (1, 'Unassigned', 1, 0, 1,"
        " 'status', '2026-01-01 00:00:00', '2026-01-01 00:00:00')"
    )
    connection.commit()
    connection.close()

    command.upgrade(config, AFTER)
    return db_path, config


def test_each_stored_value_becomes_a_list_of_one(upgraded):
    db_path, _ = upgraded
    view = _views(db_path)["Everything set"]
    lists = {
        column: json.loads(view[column])
        for column in ("status_ids", "priorities", "assignee_ids", "label_ids", "types")
    }
    assert lists == {
        "status_ids": [5],
        "priorities": ["high"],
        "assignee_ids": [3],
        "label_ids": [7],
        "types": ["bug"],
    }
    assert "status_id" not in view and "label_id" not in view


def test_an_empty_filter_becomes_an_empty_list_and_switches_start_off(upgraded):
    db_path, _ = upgraded
    view = _views(db_path)["Unassigned"]
    assert json.loads(view["status_ids"]) == []
    assert view["unassigned"] == 1
    for switch in (
        "status_exclude",
        "priority_exclude",
        "assignee_exclude",
        "label_all",
        "label_exclude",
        "type_exclude",
    ):
        assert view[switch] == 0


def test_a_rollback_keeps_the_first_value(upgraded):
    db_path, config = upgraded
    connection = sqlite3.connect(db_path)
    connection.execute(
        "UPDATE savedview SET status_ids = '[6, 5]' WHERE name = 'Everything set'"
    )
    connection.commit()
    connection.close()

    command.downgrade(config, BEFORE)
    views = _views(db_path)
    assert (views["Everything set"]["status_id"], views["Everything set"]["type"]) == (
        6,
        "bug",
    )
    assert views["Unassigned"]["status_id"] is None
    assert "status_ids" not in views["Unassigned"]
