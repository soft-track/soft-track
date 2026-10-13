"""The manager-link migration (#124), against a database with accounts in it.

One nullable self-referencing column on `user`. The risk is that the
rebuild SQLite does on the way down loses accounts, or that the foreign key
on the way up is not really there.
"""

import sqlite3

import pytest
from alembic import command

from tests.test_employee_profile_migration import _columns, _insert_user, _read
from tests.test_reactions_migration import _config

BEFORE = "48a7174ef49b"
AFTER = "6ccd108e66f0"


def test_accounts_report_to_nobody_and_it_comes_off_cleanly(tmp_path):
    db_path = tmp_path / "managers.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    _insert_user(db_path, 1, "amina@b.c", "amina")
    _insert_user(db_path, 2, "daniel@b.c", "daniel")

    command.upgrade(config, AFTER)
    assert _read(db_path, "SELECT username, manager_id FROM user ORDER BY id") == [
        ("amina", None),
        ("daniel", None),
    ]

    connection = sqlite3.connect(db_path)
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("UPDATE user SET manager_id = 1 WHERE id = 2")
    connection.commit()
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute("UPDATE user SET manager_id = 99 WHERE id = 1")
    connection.close()

    command.downgrade(config, BEFORE)
    assert "manager_id" not in _columns(db_path)
    assert _read(db_path, "SELECT id, username FROM user ORDER BY id") == [
        (1, "amina"),
        (2, "daniel"),
    ]

    command.upgrade(config, AFTER)
    assert "manager_id" in _columns(db_path)
