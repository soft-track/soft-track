"""Test for employment_type migration (revision a9ae2c8b879d).

Issue #320:
- demo@softtrack.dev is migrated to service_account
- other existing users remain NULL
- downgrade removes the column and preserves existing data
"""

import sqlite3
import pytest
from alembic import command
from alembic.config import Config

BEFORE = "275db0819719"
AFTER = "a9ae2c8b879d"


def _config(db_path) -> Config:
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return config


def test_employment_type_migration_and_downgrade(tmp_path):
    db_path = tmp_path / "test_migration.db"
    config = _config(db_path)

    # 1. Upgrade to BEFORE
    command.upgrade(config, BEFORE)

    # 2. Seed existing users at BEFORE revision
    conn = sqlite3.connect(db_path)
    # demo user
    conn.execute(
        "INSERT INTO user (id, email, username, hashed_password, full_name, avatar_color, is_active, is_site_admin, is_finance_admin, token_version, email_notifications, is_external, created_at) "
        "VALUES (1, 'demo@softtrack.dev', 'demo', 'passhash', 'Demo User', '#fff', 1, 0, 0, 0, 1, 0, '2026-01-01 00:00:00')"
    )
    # regular employee
    conn.execute(
        "INSERT INTO user (id, email, username, hashed_password, full_name, avatar_color, is_active, is_site_admin, is_finance_admin, token_version, email_notifications, is_external, created_at) "
        "VALUES (2, 'alice@softtrack.dev', 'alice', 'passhash', 'Alice Smith', '#fff', 1, 0, 0, 0, 1, 0, '2026-01-01 00:00:00')"
    )
    # external outside account
    conn.execute(
        "INSERT INTO user (id, email, username, hashed_password, full_name, avatar_color, is_active, is_site_admin, is_finance_admin, token_version, email_notifications, is_external, created_at) "
        "VALUES (3, 'contractor@outside.dev', 'contractor', 'passhash', 'Outside Contractor', '#fff', 1, 0, 0, 0, 1, 1, '2026-01-01 00:00:00')"
    )
    conn.commit()
    conn.close()

    # 3. Upgrade to AFTER
    command.upgrade(config, AFTER)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, email, full_name, is_external, employment_type FROM user ORDER BY id"
    )
    rows = cursor.fetchall()
    conn.close()

    assert len(rows) == 3

    # demo user becomes service_account
    assert rows[0] == (1, "demo@softtrack.dev", "Demo User", 0, "service_account")

    # regular user remains NULL
    assert rows[1] == (2, "alice@softtrack.dev", "Alice Smith", 0, None)

    # outside user remains NULL and is_external stays 1
    assert rows[2] == (3, "contractor@outside.dev", "Outside Contractor", 1, None)

    # 4. Downgrade to BEFORE
    command.downgrade(config, BEFORE)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    # Check that employment_type column is gone
    cursor.execute("PRAGMA table_info(user)")
    columns = [row[1] for row in cursor.fetchall()]
    assert "employment_type" not in columns

    # Existing user data remains intact
    cursor.execute("SELECT id, email, full_name, is_external FROM user ORDER BY id")
    downgraded_rows = cursor.fetchall()
    conn.close()

    assert len(downgraded_rows) == 3
    assert downgraded_rows[0] == (1, "demo@softtrack.dev", "Demo User", 0)
    assert downgraded_rows[1] == (2, "alice@softtrack.dev", "Alice Smith", 0)
    assert downgraded_rows[2] == (3, "contractor@outside.dev", "Outside Contractor", 1)
