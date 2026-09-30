"""The custom fields migration (#117), on and off a database with history in it.

Two new tables, and a nullable `custom_field_id` on two tables that already
hold rows -- `ticketevent` and `notification` -- which SQLite rebuilds. The
risks: that the existing rows survive both rebuilds, and that the downgrade
takes away the events and notifications the older code cannot read.
"""

from alembic import command
from sqlalchemy import text
from sqlmodel import Session, create_engine, select

from lib_softtrack.tables import (
    CustomField,
    CustomFieldKind,
    CustomFieldValue,
    Notification,
    NotificationKind,
    TicketEvent,
    TicketEventField,
)
from tests.test_employee_profile_migration import _read
from tests.test_reactions_migration import _config

BEFORE = "3309e3a2ef3f"
AFTER = "cf3f72037267"


def _tables(db_path):
    return {
        row[0]
        for row in _read(db_path, "SELECT name FROM sqlite_master WHERE type='table'")
    }


def _seed(engine) -> None:
    """A ticket with a status event and a notification, written as of AFTER.

    The team, account, status and ticket in SQL rather than through the
    models: the models are the latest schema, and a column added to any of
    those tables since AFTER (the trash's, #323) is not in this database.
    """
    with engine.begin() as connection:
        for statement in (
            "INSERT INTO team (id, name, key, next_ticket_number,"
            " next_sprint_number, created_at)"
            " VALUES (1, 'Engineering', 'ENG', 2, 1, '2026-01-01 00:00:00')",
            "INSERT INTO user (id, email, username, hashed_password, full_name,"
            " avatar_color, is_active, is_site_admin, is_finance_admin,"
            " token_version, email_notifications, created_at)"
            " VALUES (1, 'ada@softtrack.dev', 'ada', 'x', 'Ada', '#6366f1', 1, 0,"
            " 0, 0, 1, '2026-01-01 00:00:00')",
            "INSERT INTO workflowstatus (id, team_id, name, category, position,"
            " color, created_at)"
            " VALUES (1, 1, 'Todo', 'unstarted', 0, '#888', '2026-01-01 00:00:00')",
            "INSERT INTO ticket (id, team_id, number, title, priority, type,"
            " creator_id, created_at, updated_at, status_id)"
            " VALUES (1, 1, 1, 'Work', 'no_priority', 'task', 1,"
            " '2026-01-01 00:00:00', '2026-01-01 00:00:00', 1)",
        ):
            connection.execute(text(statement))
    with Session(engine) as session:
        session.add(
            TicketEvent(
                ticket_id=1,
                team_id=1,
                field=TicketEventField.status,
                new_value="started",
                actor_id=1,
            )
        )
        session.add(
            Notification(user_id=1, kind=NotificationKind.assigned, ticket_id=1)
        )
        session.commit()


def test_fields_go_on_and_come_off_with_what_pointed_at_them(tmp_path):
    db_path = tmp_path / "fields.db"
    config = _config(db_path)
    command.upgrade(config, AFTER)
    engine = create_engine(f"sqlite:///{db_path}")
    _seed(engine)

    # In SQL for the same reason as the seed: flushing a value through the
    # models wakes listeners that read the ticket as the latest schema has it.
    with engine.begin() as connection:
        for statement in (
            "INSERT INTO customfield (id, team_id, key, name, kind, options,"
            " required, applies_to, position, created_at) VALUES (1, 1,"
            " 'environment', 'Environment', 'select',"
            ' \'[{"id": "production", "name": "Production"}]\', 0, \'["bug"]\','
            " 0, '2026-01-01 00:00:00')",
            "INSERT INTO customfieldvalue (ticket_id, field_id, value, updated_at)"
            " VALUES (1, 1, '\"production\"', '2026-01-01 00:00:00')",
            "INSERT INTO ticketevent (ticket_id, team_id, field, custom_field_id,"
            " new_value, actor_id, created_at, opening) VALUES (1, 1,"
            " 'custom_field', 1, 'production', 1, '2026-01-01 00:00:00', 0)",
            "INSERT INTO notification (user_id, kind, ticket_id, custom_field_id,"
            " created_at) VALUES (1, 'field_assigned', 1, 1, '2026-01-01 00:00:00')",
        ):
            connection.execute(text(statement))
    engine.dispose()
    assert _read(db_path, "SELECT value FROM customfieldvalue") == [('"production"',)]
    assert _read(db_path, "SELECT options FROM customfield") == [
        ('[{"id": "production", "name": "Production"}]',)
    ]

    command.downgrade(config, BEFORE)
    assert {"customfield", "customfieldvalue"}.isdisjoint(_tables(db_path))
    # What the older code can read stays; what it cannot goes.
    assert _read(db_path, "SELECT field, new_value FROM ticketevent") == [
        ("status", "started")
    ]
    assert _read(db_path, "SELECT kind FROM notification") == [("assigned",)]
    columns = {row[1] for row in _read(db_path, "PRAGMA table_info(ticketevent)")}
    assert "custom_field_id" not in columns

    command.upgrade(config, AFTER)
    assert {"customfield", "customfieldvalue"} <= _tables(db_path)
