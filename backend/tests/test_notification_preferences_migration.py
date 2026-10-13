"""The notification preferences migration (#263), against existing rows.

The digest used to skip whoever had `email_notifications` off; it reads each
row's `by_email` now, so a row still waiting for a digest has to come out of
the upgrade with the switch its person has today.
"""

import sqlite3

from alembic import command
from alembic.config import Config

BEFORE = "c3f81d5a2e67"
AFTER = "b5d1e7a3c942"


def test_waiting_rows_follow_the_old_switch_and_the_downgrade_is_clean(tmp_path):
    db_path = tmp_path / "preferences.db"
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
        " (1, 'on@b.c', 'on', 'x', 'On', '#fff', 1, 0, 0, 0, 1, '2026-01-01'),"
        " (2, 'off@b.c', 'off', 'x', 'Off', '#fff', 1, 0, 0, 0, 0, '2026-01-01');"
        "INSERT INTO teammember (team_id, user_id, role, joined_at) VALUES"
        " (1, 1, 'admin', '2026-01-01');"
        "INSERT INTO workflowstatus (id, team_id, name, category, position, color,"
        " created_at) VALUES (1, 1, 'Todo', 'unstarted', 0, '#888', '2026-01-01');"
        "INSERT INTO ticket (id, team_id, number, title, status_id, priority,"
        " creator_id, created_at, updated_at) VALUES (1, 1, 1, 'W', 1,"
        " 'no_priority', 1, '2026-01-01', '2026-01-01');"
        "INSERT INTO notification (id, user_id, kind, ticket_id, emailed_at,"
        " created_at) VALUES"
        " (1, 1, 'commented', 1, NULL, '2026-01-01'),"
        " (2, 2, 'commented', 1, NULL, '2026-01-01'),"
        " (3, 2, 'commented', 1, '2026-01-02', '2026-01-01');"
    )
    connection.commit()
    connection.close()

    command.upgrade(config, AFTER)
    connection = sqlite3.connect(db_path)
    rows = connection.execute(
        "SELECT id, in_app, by_email FROM notification ORDER BY id"
    ).fetchall()
    muted = connection.execute("SELECT notifications_muted FROM teammember").fetchall()
    connection.close()
    # Everything stays in the inbox. The waiting row of the person with
    # email off will not be mailed; the one already sent is left as it was.
    assert rows == [(1, 1, 1), (2, 1, 0), (3, 1, 1)]
    assert muted == [(0,)]

    command.downgrade(config, BEFORE)
    connection = sqlite3.connect(db_path)
    tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master")}
    columns = {r[1] for r in connection.execute("PRAGMA table_info(notification)")}
    count = connection.execute("SELECT count(*) FROM notification").fetchone()[0]
    connection.close()
    assert "notificationpreference" not in tables
    assert not {"in_app", "by_email"} & columns
    assert count == 3
    command.upgrade(config, AFTER)
