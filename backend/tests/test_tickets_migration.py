"""The ticket rename (#215): `issue` and everything that named it -- six
tables, ten columns, and every index, constraint and search trigger on them --
renamed on the way up and back on the way down, with every row intact."""

import re
import sqlite3

from alembic import command
from alembic.config import Config

BEFORE = "246debfdbf3b"
AFTER = "06abb8eb700e"

STAMP = "'2026-01-01 00:00:00'"

#: The tables whose names change, by the old name.
RENAMED = {
    "issue": "ticket",
    "issueevent": "ticketevent",
    "issuelabellink": "ticketlabellink",
    "issuelink": "ticketlink",
    "issuetemplate": "tickettemplate",
    "issuewatch": "ticketwatch",
}

#: Tables that keep their names but hold a column or a string that changes.
TOUCHED = (
    "team",
    "attachment",
    "notification",
    "comment",
    "codelink",
    "worklog",
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
    """One of everything that names an issue, written before the rename."""
    connection = sqlite3.connect(db_path)
    connection.executescript(
        "INSERT INTO team (id, name, key, next_issue_number, next_sprint_number,"
        f" created_at) VALUES (1, 'E', 'ENG', 4, 1, {STAMP});"
        "INSERT INTO user (id, email, username, hashed_password, full_name,"
        " avatar_color, is_active, is_site_admin, token_version,"
        " email_notifications, created_at) VALUES (1, 'a@b.c', 'a', 'x', 'A',"
        f" '#fff', 1, 0, 0, 1, {STAMP});"
        "INSERT INTO workflowstatus (id, team_id, name, category, position, color,"
        f" created_at) VALUES (1, 1, 'Todo', 'unstarted', 0, '#888', {STAMP});"
        "INSERT INTO label (id, team_id, name, color) VALUES (1, 1, 'Bug', '#f00');"
        "INSERT INTO issue (id, team_id, number, title, description, status_id,"
        " priority, type, rank, creator_id, created_at, updated_at) VALUES (1, 1,"
        " 1, 'Connection drops', 'The websocket keeps dropping', 1, 'high', 'bug',"
        f" 'a0', 1, {STAMP}, {STAMP});"
        "INSERT INTO issue (id, team_id, number, title, status_id, priority, type,"
        " rank, parent_id, creator_id, created_at, updated_at) VALUES (2, 1, 2,"
        f" 'Retry it', 1, 'no_priority', 'task', 'a1', 1, 1, {STAMP}, {STAMP});"
        "INSERT INTO issueevent (id, issue_id, team_id, field, old_value, new_value,"
        f" actor_id, created_at, opening) VALUES (1, 1, 1, 'status', NULL, '1', 1,"
        f" {STAMP}, 1);"
        "INSERT INTO issuelabellink (issue_id, label_id) VALUES (1, 1);"
        "INSERT INTO issuelink (id, source_id, target_id, type, created_by_id,"
        f" created_at) VALUES (1, 1, 2, 'blocks', 1, {STAMP});"
        "INSERT INTO issuetemplate (id, team_id, name, body, position, created_at,"
        f" updated_at) VALUES (1, 1, 'Bug report', '## Steps', 0, {STAMP}, {STAMP});"
        "INSERT INTO issuewatch (issue_id, user_id, watching, created_at) VALUES"
        f" (1, 1, 1, {STAMP});"
        "INSERT INTO attachment (id, issue_id, filename, content_type, size_bytes,"
        " storage_key, uploaded_by_id, created_at) VALUES (1, 1, 'a.png',"
        f" 'image/png', 3, 'k', 1, {STAMP});"
        "INSERT INTO notification (id, user_id, kind, issue_id, created_at) VALUES"
        f" (1, 1, 'assigned', 1, {STAMP});"
        "INSERT INTO comment (id, issue_id, author_id, body, created_at) VALUES"
        f" (1, 1, 1, 'Seen it with zeppelins too', {STAMP});"
        "INSERT INTO repository (id, team_id, provider, full_name, hook_token,"
        " secret, created_by_id, created_at) VALUES (1, 1, 'github', 'acme/app',"
        f" 't', 's', 1, {STAMP});"
        "INSERT INTO codelink (id, issue_id, repository_id, kind, external_id, url,"
        " created_at, updated_at) VALUES (1, 1, 1, 'branch', 'eng-1-fix',"
        f" 'https://example.com/b', {STAMP}, {STAMP});"
        "INSERT INTO worklog (id, issue_id, user_id, minutes, worked_on, created_at,"
        f" updated_at) VALUES (1, 1, 1, 30, '2026-01-01', {STAMP}, {STAMP});"
        'INSERT INTO automationrule (id, team_id, name, is_enabled, "trigger",'
        " if_unassigned, move_to_active_sprint, created_by_id, created_at,"
        f" updated_at) VALUES (1, 1, 'Triage', 1, 'issue_created', 0, 0, 1,"
        f" {STAMP}, {STAMP});"
        'INSERT INTO automationrun (id, team_id, rule_id, rule_name, "trigger",'
        " issue_id, summary, created_at) VALUES (1, 1, 1, 'Triage', 'issue_assigned',"
        f" 1, 'Assigned to A', {STAMP});"
        "INSERT INTO outboundwebhook (id, team_id, url, secret, events, is_enabled,"
        " consecutive_failures, created_by_id, created_at) VALUES (1, 1,"
        " 'https://example.com/hook', 's',"
        " 'issue.created,issue.status_changed,issue.updated,sprint.completed', 1, 0,"
        f" 1, {STAMP});"
        "INSERT INTO webhookdelivery (id, webhook_id, event, payload, status,"
        " attempts, created_at) VALUES (1, 1, 'issue.updated', '{}', 'delivered', 1,"
        f" {STAMP});"
    )
    connection.commit()
    connection.close()


def _shape(db_path):
    """The schema as it matters, and every row: what a round trip must keep.

    Read through the pragmas rather than compared as DDL text, because a
    rebuild writes its own CREATE TABLE -- the same table, spelled differently.
    The search index's own tables are left out: rebuilding it can store the
    same index differently. What it finds is checked separately.
    """
    connection = sqlite3.connect(db_path)
    shape = {}
    for table in (*RENAMED, *RENAMED.values(), *TOUCHED):
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
            "rows": connection.execute(f"SELECT * FROM {table}").fetchall(),
        }
    shape["triggers"] = sorted(
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'trigger'"
        )
    )
    connection.close()
    return shape


def _match(db_path, table, query):
    connection = sqlite3.connect(db_path)
    rows = connection.execute(
        f"SELECT rowid FROM {table} WHERE {table} MATCH ?", (query,)
    ).fetchall()
    connection.close()
    return [row[0] for row in rows]


def test_everything_that_named_an_issue_names_a_ticket(tmp_path):
    from sqlmodel import Session, create_engine

    from lib_softtrack.outbound import parse_events
    from lib_softtrack.tables import (
        AutomationRule,
        AutomationTrigger,
        OutboundWebhook,
        Ticket,
        TicketTemplate,
        WebhookEvent,
    )

    db_path = tmp_path / "tickets.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    _seed(db_path)
    command.upgrade(config, AFTER)

    connection = sqlite3.connect(db_path)
    schema = " ".join(
        f"{name} {sql or ''}"
        for name, sql in connection.execute("SELECT name, sql FROM sqlite_master")
    )
    # Not a table, column, index, constraint or trigger still says it.
    assert "issue" not in schema.lower()

    def rows(sql):
        return connection.execute(sql).fetchall()

    assert rows("SELECT id, parent_id FROM ticket ORDER BY id") == [(1, None), (2, 1)]
    assert rows("SELECT next_ticket_number FROM team") == [(4,)]
    for table in (
        "ticketevent",
        "ticketlabellink",
        "ticketwatch",
        "attachment",
        "notification",
        "comment",
        "codelink",
        "worklog",
        "automationrun",
    ):
        assert rows(f"SELECT ticket_id FROM {table}") == [(1,)], table
    assert rows("SELECT source_id, target_id FROM ticketlink") == [(1, 2)]
    assert rows("SELECT name FROM tickettemplate") == [("Bug report",)]
    assert rows('SELECT "trigger" FROM automationrule') == [("ticket_created",)]
    assert rows('SELECT "trigger" FROM automationrun') == [("ticket_assigned",)]
    assert rows("SELECT events FROM outboundwebhook") == [
        ("sprint.completed,ticket.created,ticket.status_changed,ticket.updated",)
    ]
    assert rows("SELECT event FROM webhookdelivery") == [("ticket.updated",)]
    connection.close()

    # The index was built again over `ticket`: what it found, it still finds,
    # and it keeps following edits.
    assert _match(db_path, "ticket_fts", "websocket") == [1]
    assert _match(db_path, "comment_fts", "zeppelins") == [1]
    connection = sqlite3.connect(db_path)
    connection.execute("UPDATE ticket SET title = 'Retry on reconnect' WHERE id = 2")
    connection.commit()
    connection.close()
    assert _match(db_path, "ticket_fts", "reconnect") == [2]

    # Read back through the models, so a name the migration spelled
    # differently from the table classes fails here rather than in production.
    # At head: the models are the latest schema, and the revisions after this
    # one add columns it does not have (the trash's, #323).
    command.upgrade(config, "head")
    engine = create_engine(f"sqlite:///{db_path}")
    with Session(engine) as session:
        assert session.get(Ticket, 2).parent_id == 1
        assert session.get(TicketTemplate, 1).name == "Bug report"
        assert (
            session.get(AutomationRule, 1).trigger is AutomationTrigger.ticket_created
        )
        assert parse_events(session.get(OutboundWebhook, 1).events) == [
            WebhookEvent.sprint_completed,
            WebhookEvent.ticket_created,
            WebhookEvent.ticket_status_changed,
            WebhookEvent.ticket_updated,
        ]
    engine.dispose()


def test_the_rename_comes_off_cleanly(tmp_path):
    db_path = tmp_path / "round-trip.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    _seed(db_path)
    before = _shape(db_path)

    command.upgrade(config, AFTER)
    command.downgrade(config, BEFORE)
    assert _shape(db_path) == before
    assert _match(db_path, "issue_fts", "websocket") == [1]

    # And up again, for a database that went down and comes back.
    command.upgrade(config, AFTER)
    assert _match(db_path, "ticket_fts", "websocket") == [1]
