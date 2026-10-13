"""The due-date reminders migration (#262), against existing rows.

The code a downgrade goes back to cannot read a reminder, so the reminders
go with it and every other notification stays.
"""

import sqlite3

from alembic import command
from alembic.config import Config

BEFORE = "b5d1e7a3c942"
AFTER = "d7a4c2e91b58"


def test_the_upgrade_adds_the_record_and_the_downgrade_takes_reminders_away(
    tmp_path,
):
    db_path = tmp_path / "reminders.db"
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    command.upgrade(config, BEFORE)
    connection = sqlite3.connect(db_path)
    connection.executescript(
        "INSERT INTO team (id, name, key, next_ticket_number, next_sprint_number,"
        " created_at) VALUES (1, 'E', 'ENG', 2, 1, '2026-01-01');"
        "INSERT INTO user (id, email, username, hashed_password, full_name,"
        " avatar_color, is_active, is_site_admin, is_finance_admin, token_version,"
        " email_notifications, created_at) VALUES"
        " (1, 'a@b.c', 'a', 'x', 'A', '#fff', 1, 0, 0, 0, 1, '2026-01-01');"
        "INSERT INTO workflowstatus (id, team_id, name, category, position, color,"
        " created_at) VALUES (1, 1, 'Todo', 'unstarted', 0, '#888', '2026-01-01');"
        "INSERT INTO ticket (id, team_id, number, title, status_id, priority,"
        " creator_id, due_date, created_at, updated_at) VALUES (1, 1, 1, 'W', 1,"
        " 'no_priority', 1, '2026-10-04', '2026-01-01', '2026-01-01');"
        "INSERT INTO notification (id, user_id, kind, ticket_id, created_at)"
        " VALUES (1, 1, 'commented', 1, '2026-01-01');"
    )
    connection.commit()
    connection.close()

    command.upgrade(config, AFTER)
    connection = sqlite3.connect(db_path)
    connection.executescript(
        "INSERT INTO duereminder (ticket_id, user_id, due_date, stage, claimed_at)"
        " VALUES (1, 1, '2026-10-04', 'due_tomorrow', '2026-10-03 08:00');"
        "INSERT INTO notification (id, user_id, kind, ticket_id, due_date,"
        " created_at) VALUES (2, 1, 'due_tomorrow', 1, '2026-10-04', '2026-10-03');"
    )
    connection.commit()
    connection.close()

    command.downgrade(config, BEFORE)
    connection = sqlite3.connect(db_path)
    tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master")}
    columns = {r[1] for r in connection.execute("PRAGMA table_info(notification)")}
    kinds = connection.execute("SELECT kind FROM notification").fetchall()
    connection.close()
    assert "duereminder" not in tables
    assert "due_date" not in columns
    assert kinds == [("commented",)]
    command.upgrade(config, AFTER)
