"""The departments migration (#123), against a database with accounts in it.

A new table and a nullable foreign key on `user`, so the risk is small and
specific: that every existing account comes out in no department, that the
case-folded name key is unique, and that the downgrade -- which rebuilds
`user` on SQLite -- keeps the accounts and nothing of this revision.
"""

import sqlite3

import pytest
from alembic import command

from tests.test_employee_profile_migration import _columns, _insert_user, _read
from tests.test_reactions_migration import _config

BEFORE = "24d062e0431b"
AFTER = "48a7174ef49b"


def _tables(db_path):
    return {
        row[0]
        for row in _read(db_path, "SELECT name FROM sqlite_master WHERE type='table'")
    }


def test_accounts_come_out_in_no_department_and_it_comes_off_cleanly(tmp_path):
    db_path = tmp_path / "departments.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    _insert_user(db_path, 1, "ada@b.c", "ada")

    command.upgrade(config, AFTER)
    assert _read(db_path, "SELECT username, department_id FROM user") == [("ada", None)]

    connection = sqlite3.connect(db_path)
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute(
        "INSERT INTO department (id, name, name_key, created_at)"
        " VALUES (1, 'Engineering', 'engineering', '2026-01-01 00:00:00')"
    )
    connection.execute("UPDATE user SET department_id = 1 WHERE id = 1")
    connection.commit()
    # The key is unique, whatever the name's case says.
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            "INSERT INTO department (id, name, name_key, created_at)"
            " VALUES (2, 'ENGINEERING', 'engineering', '2026-01-01 00:00:00')"
        )
    # And an account cannot point at a department that is not there.
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute("UPDATE user SET department_id = 99 WHERE id = 1")
    connection.close()

    command.downgrade(config, BEFORE)
    assert "department_id" not in _columns(db_path)
    assert "department" not in _tables(db_path)
    assert _read(db_path, "SELECT id, email, username FROM user") == [
        (1, "ada@b.c", "ada")
    ]

    command.upgrade(config, AFTER)
    assert "department_id" in _columns(db_path)
