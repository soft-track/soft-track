"""The trash migration (#323), on and off a database with a team in it.

Three things matter. A team that existed before keeps deleting the way it
always has -- any member, any ticket -- where a new team starts with only a
ticket's creator and its admins. The search index's triggers on `ticket`
survive the rebuild that adding a foreign key costs on SQLite (the sweep in
tests/test_search_fts.py checks that for every revision). And going back
restores what was in the trash rather than losing it, taking away the
`trash` history the older code cannot read.
"""

import sqlite3

from alembic import command

from tests.test_employee_profile_migration import _read
from tests.test_reactions_migration import _config

BEFORE = "266072764727"
AFTER = "45e4506be3db"
NOW = "'2026-01-01 00:00:00'"


def _seed(db_path):
    connection = sqlite3.connect(db_path)
    run = connection.execute
    run(
        "INSERT INTO user (id, email, username, hashed_password, full_name,"
        " avatar_color, is_active, is_site_admin, is_finance_admin, token_version,"
        f" email_notifications, created_at) VALUES (1, 'a@b.c', 'a', 'x', 'A',"
        f" '#6366f1', 1, 0, 0, 0, 1, {NOW})"
    )
    run(
        "INSERT INTO team (id, name, key, next_ticket_number, next_sprint_number,"
        f" created_at) VALUES (1, 'Engineering', 'ENG', 3, 1, {NOW})"
    )
    run(
        "INSERT INTO workflowstatus (id, team_id, name, category, position, color,"
        f" created_at) VALUES (1, 1, 'Todo', 'unstarted', 0, '#888', {NOW})"
    )
    for ticket_id in (1, 2):
        run(
            "INSERT INTO ticket (id, team_id, number, title, priority, type,"
            " creator_id, created_at, updated_at, status_id) VALUES"
            f" ({ticket_id}, 1, {ticket_id}, 'Zeppelin {ticket_id}', 'no_priority',"
            f" 'task', 1, {NOW}, {NOW}, 1)"
        )
    connection.commit()
    connection.close()


def test_a_team_from_before_keeps_letting_every_member_delete(tmp_path):
    db_path = tmp_path / "trash.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    _seed(db_path)
    command.upgrade(config, AFTER)

    assert _read(db_path, "SELECT any_member_may_delete FROM team") == [(1,)]
    assert _read(db_path, "SELECT id, deleted_at, deleted_by_id FROM ticket") == [
        (1, None, None),
        (2, None, None),
    ]


def test_going_back_restores_the_trash(tmp_path):
    db_path = tmp_path / "trash.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    _seed(db_path)
    command.upgrade(config, AFTER)

    connection = sqlite3.connect(db_path)
    connection.execute(
        f"UPDATE ticket SET deleted_at = {NOW}, deleted_by_id = 1 WHERE id = 2"
    )
    connection.execute(
        "INSERT INTO ticketevent (ticket_id, team_id, field, new_value, actor_id,"
        f" created_at, opening) VALUES (2, 1, 'trash', {NOW}, 1, {NOW}, 0)"
    )
    connection.commit()
    connection.close()

    command.downgrade(config, BEFORE)

    columns = {row[1] for row in _read(db_path, "PRAGMA table_info(ticket)")}
    assert {"deleted_at", "deleted_by_id"}.isdisjoint(columns)
    assert _read(db_path, "SELECT id FROM ticket ORDER BY id") == [(1,), (2,)]
    assert _read(db_path, "SELECT field FROM ticketevent") == []
    # The search index still follows edits after the rebuild going back.
    connection = sqlite3.connect(db_path)
    connection.execute("UPDATE ticket SET title = 'Airship 2' WHERE id = 2")
    connection.commit()
    found = connection.execute(
        "SELECT rowid FROM ticket_fts WHERE ticket_fts MATCH 'airship'"
    ).fetchall()
    connection.close()
    assert found == [(2,)]
