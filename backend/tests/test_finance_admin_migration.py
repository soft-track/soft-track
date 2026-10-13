"""The finance-admin migration (#130), against a database with accounts in it.

A boolean that has to arrive false on every existing row, the site admin's
included, and a link to whoever granted it that has to be a real foreign key.
"""

import sqlite3

import pytest
from alembic import command

from tests.test_employee_profile_migration import _columns, _insert_user, _read
from tests.test_reactions_migration import _config

BEFORE = "6ccd108e66f0"
AFTER = "042116f2d4de"


def test_nobody_can_see_money_after_the_upgrade_and_it_comes_off_cleanly(tmp_path):
    db_path = tmp_path / "finance.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    _insert_user(db_path, 1, "sofia@b.c", "sofia")
    _insert_user(db_path, 2, "grace@b.c", "grace")
    connection = sqlite3.connect(db_path)
    connection.execute("UPDATE user SET is_site_admin = 1 WHERE id = 1")
    connection.commit()
    connection.close()

    command.upgrade(config, AFTER)
    assert _read(
        db_path,
        "SELECT username, is_site_admin, is_finance_admin, finance_admin_since,"
        " finance_admin_granted_by_id FROM user ORDER BY id",
    ) == [("sofia", 1, 0, None, None), ("grace", 0, 0, None, None)]

    connection = sqlite3.connect(db_path)
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute(
        "UPDATE user SET is_finance_admin = 1, finance_admin_granted_by_id = 1"
        " WHERE id = 2"
    )
    connection.commit()
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute("UPDATE user SET finance_admin_granted_by_id = 99")
    connection.close()

    command.downgrade(config, BEFORE)
    assert not {
        "is_finance_admin",
        "finance_admin_since",
        "finance_admin_granted_by_id",
    } & _columns(db_path)
    assert _read(db_path, "SELECT id, username FROM user ORDER BY id") == [
        (1, "sofia"),
        (2, "grace"),
    ]

    command.upgrade(config, AFTER)
    assert "is_finance_admin" in _columns(db_path)
