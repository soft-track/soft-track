"""The sprint rename (#214): `cycle` and everything that named it, renamed on
the way up and back on the way down, with every row still where it was."""

import re
import sqlite3

from alembic import command
from alembic.config import Config

BEFORE = "c7e3a9d15b28"
AFTER = "246debfdbf3b"

STAMP = "'2026-01-01 00:00:00'"

#: Every table the rename touches, and the two that only hold strings it
#: rewrites.
TABLES = (
    "team",
    "issue",
    "issueevent",
    "savedview",
    "automationrule",
    "automationrun",
    "outboundwebhook",
    "webhookdelivery",
)


def _config(db_path):
    config = Config("alembic.ini")
    config.set_main_option("script_location", "alembic")
    config.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return config


def _seed(db_path):
    """One of everything that names a cycle, written before the rename."""
    connection = sqlite3.connect(db_path)
    connection.executescript(
        "INSERT INTO team (id, name, key, next_issue_number, next_cycle_number,"
        f" created_at) VALUES (1, 'E', 'ENG', 2, 3, {STAMP});"
        "INSERT INTO user (id, email, username, hashed_password, full_name,"
        " avatar_color, is_active, is_site_admin, token_version,"
        " email_notifications, created_at) VALUES (1, 'a@b.c', 'a', 'x', 'A',"
        f" '#fff', 1, 0, 0, 1, {STAMP});"
        "INSERT INTO workflowstatus (id, team_id, name, category, position, color,"
        f" created_at) VALUES (1, 1, 'Todo', 'unstarted', 0, '#888', {STAMP});"
        "INSERT INTO cycle (id, team_id, number, name, starts_at, ends_at, state,"
        f" created_at) VALUES (1, 1, 2, NULL, {STAMP}, {STAMP}, 'active', {STAMP});"
        "INSERT INTO issue (id, team_id, number, title, status_id, priority, type,"
        " rank, creator_id, cycle_id, created_at, updated_at) VALUES (1, 1, 1,"
        f" 'Ship it', 1, 'no_priority', 'task', 'a0', 1, 1, {STAMP}, {STAMP});"
        "INSERT INTO issueevent (id, issue_id, team_id, field, old_value, new_value,"
        f" actor_id, created_at, opening) VALUES (1, 1, 1, 'cycle', NULL, '1', 1,"
        f" {STAMP}, 0);"
        "INSERT INTO savedview (id, team_id, name, owner_id, is_shared, unassigned,"
        " cycle_id, group_by, created_at, updated_at) VALUES (1, 1, 'Now', 1, 1, 0,"
        f" 1, 'status', {STAMP}, {STAMP});"
        'INSERT INTO automationrule (id, team_id, name, is_enabled, "trigger",'
        " if_unassigned, set_cycle_id, move_to_active_cycle, created_by_id,"
        " created_at, updated_at) VALUES (1, 1, 'Carry on', 1, 'cycle_completed',"
        f" 0, 1, 0, 1, {STAMP}, {STAMP});"
        'INSERT INTO automationrun (id, team_id, rule_id, rule_name, "trigger",'
        " issue_id, summary, created_at) VALUES (1, 1, 1, 'Carry on',"
        f" 'cycle_completed', 1, 'Moved to Cycle 2', {STAMP});"
        "INSERT INTO outboundwebhook (id, team_id, url, secret, events, is_enabled,"
        " consecutive_failures, created_by_id, created_at) VALUES (1, 1,"
        " 'https://example.com/hook', 's',"
        f" 'cycle.completed,cycle.started,issue.created', 1, 0, 1, {STAMP});"
        "INSERT INTO webhookdelivery (id, webhook_id, event, payload, status,"
        " attempts, created_at) VALUES (1, 1, 'cycle.started', '{}', 'delivered', 1,"
        f" {STAMP});"
    )
    connection.commit()
    connection.close()


def _shape(db_path):
    """The schema as it matters, and every row: what a round trip must keep.

    Read through the pragmas rather than compared as DDL text, because a
    rebuild writes its own CREATE TABLE -- the same table, spelled differently.
    """
    connection = sqlite3.connect(db_path)
    shape = {}
    for table in (*TABLES, "cycle", "sprint"):
        ddl = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
        ).fetchone()
        if ddl is None:
            continue
        shape[table] = {
            "columns": connection.execute(f"PRAGMA table_info('{table}')").fetchall(),
            "foreign keys": sorted(
                (row[2], row[3], row[4])
                for row in connection.execute(f"PRAGMA foreign_key_list('{table}')")
            ),
            "constraint names": sorted(re.findall(r"CONSTRAINT (\w+)", ddl[0])),
            "indexes": sorted(
                row[1] for row in connection.execute(f"PRAGMA index_list('{table}')")
            ),
            "rows": connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall(),
        }
    shape["triggers"] = sorted(
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'trigger'"
        )
    )
    connection.close()
    return shape


def test_everything_that_named_a_cycle_names_a_sprint(tmp_path):
    from sqlmodel import Session, create_engine

    from lib_softtrack.outbound import parse_events
    from lib_softtrack.tables import (
        AutomationRule,
        AutomationTrigger,
        OutboundWebhook,
        Sprint,
        SprintState,
        Ticket,
        WebhookEvent,
    )

    db_path = tmp_path / "sprints.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    _seed(db_path)
    command.upgrade(config, AFTER)

    connection = sqlite3.connect(db_path)
    schema = " ".join(
        row[0]
        for row in connection.execute(
            "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL"
        )
    )
    # Not a table, column, index, constraint or trigger still says it.
    assert "cycle" not in schema.lower()

    def one(sql):
        return connection.execute(sql).fetchone()

    assert one("SELECT number, state FROM sprint") == (2, "active")
    assert one("SELECT sprint_id FROM issue") == (1,)
    assert one("SELECT next_sprint_number FROM team") == (3,)
    assert one("SELECT field FROM issueevent") == ("sprint",)
    assert one("SELECT sprint_id FROM savedview") == (1,)
    assert one(
        'SELECT "trigger", set_sprint_id, move_to_active_sprint FROM automationrule'
    ) == ("sprint_completed", 1, 0)
    # The log keeps the words it was written in.
    assert one('SELECT "trigger", summary FROM automationrun') == (
        "sprint_completed",
        "Moved to Cycle 2",
    )
    assert one("SELECT events FROM outboundwebhook") == (
        "issue.created,sprint.completed,sprint.started",
    )
    assert one("SELECT event FROM webhookdelivery") == ("sprint.started",)
    connection.close()

    # Read back through the models, so a name the migration spelled
    # differently from the table classes fails here rather than in production.
    # At head, since they describe today's schema -- tickets included (#215).
    command.upgrade(config, "head")
    engine = create_engine(f"sqlite:///{db_path}")
    with Session(engine) as session:
        assert session.get(Sprint, 1).state is SprintState.active
        assert session.get(Ticket, 1).sprint_id == 1
        rule = session.get(AutomationRule, 1)
        assert rule.trigger is AutomationTrigger.sprint_completed
        assert rule.set_sprint_id == 1
        # issue.created went on to be ticket.created, in 06abb8eb700e.
        assert parse_events(session.get(OutboundWebhook, 1).events) == [
            WebhookEvent.sprint_completed,
            WebhookEvent.sprint_started,
            WebhookEvent.ticket_created,
        ]
    engine.dispose()


def test_the_search_index_still_follows_edits(tmp_path):
    """Renaming a foreign key rebuilds `issue` on SQLite, which drops its
    triggers; the migration puts them back."""
    db_path = tmp_path / "search.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    _seed(db_path)
    command.upgrade(config, AFTER)

    connection = sqlite3.connect(db_path)
    connection.execute("UPDATE issue SET title = 'Retitled zeppelin' WHERE id = 1")
    connection.commit()
    hits = connection.execute(
        "SELECT rowid FROM issue_fts WHERE issue_fts MATCH 'zeppelin'"
    ).fetchall()
    connection.close()
    assert hits == [(1,)]


def test_the_rename_comes_off_cleanly(tmp_path):
    db_path = tmp_path / "round-trip.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    _seed(db_path)
    before = _shape(db_path)

    command.upgrade(config, AFTER)
    command.downgrade(config, BEFORE)
    assert _shape(db_path) == before

    # And up again, for a database that went down and comes back.
    command.upgrade(config, AFTER)
    assert "sprint" in _shape(db_path)
