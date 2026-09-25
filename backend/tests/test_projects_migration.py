"""The project-lifecycle migration, run against a database that already has
projects in it (issue #60).

The risk here is the existing rows: `state` and `archived` arrive NOT NULL,
and a migration that forgot the server default -- or dropped it in the same
SQLite batch that added the column -- fails on the first install that has ever
made a project. The Postgres half, where `projectstate` has to be created
before `add_column` can use it, was checked by hand against postgres:16-alpine.
"""

import sqlite3

import pytest
from alembic import command
from alembic.config import Config

BEFORE = "6b7e8d9f0a12"
AFTER = "d8c2a6f41e93"


def _config(db_path) -> Config:
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return config


@pytest.fixture
def upgraded(tmp_path):
    """A database at the previous revision, holding a team with a project."""
    db_path = tmp_path / "projects.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)

    connection = sqlite3.connect(db_path)
    connection.execute(
        "INSERT INTO team (id, name, key, next_issue_number, next_cycle_number,"
        " created_at) VALUES (1, 'Engineering', 'ENG', 1, 1,"
        " '2026-01-01 00:00:00')"
    )
    connection.execute(
        "INSERT INTO project (team_id, name, color, created_at)"
        " VALUES (1, 'Platform', '#6366f1', '2026-01-01 00:00:00')"
    )
    connection.commit()
    connection.close()

    command.upgrade(config, AFTER)
    return db_path, config


def _project(db_path):
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    row = connection.execute("SELECT * FROM project").fetchone()
    connection.close()
    return dict(row)


def test_an_existing_project_comes_out_planned_and_unarchived(upgraded):
    db_path, _ = upgraded
    project = _project(db_path)
    assert project["name"] == "Platform"
    assert project["state"] == "planned"
    assert project["archived"] == 0
    assert project["lead_id"] is None
    assert project["target_date"] is None


def test_the_defaults_do_not_outlive_the_migration(upgraded):
    """The model supplies them. A server default left behind would make
    autogenerate report a difference on every run from here on."""
    db_path, _ = upgraded
    connection = sqlite3.connect(db_path)
    defaults = {
        row[1]: row[4] for row in connection.execute("PRAGMA table_info(project)")
    }
    connection.close()
    assert defaults["state"] is None
    assert defaults["archived"] is None


def test_a_rollback_keeps_the_project(upgraded):
    db_path, config = upgraded
    command.downgrade(config, BEFORE)
    project = _project(db_path)
    assert project["name"] == "Platform"
    assert "state" not in project
    assert "lead_id" not in project
