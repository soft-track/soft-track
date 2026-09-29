"""The custom fields migration (#117), on and off a database with history in it.

Two new tables, and a nullable `custom_field_id` on two tables that already
hold rows -- `ticketevent` and `notification` -- which SQLite rebuilds. The
risks: that the existing rows survive both rebuilds, and that the downgrade
takes away the events and notifications the older code cannot read.
"""

from alembic import command
from sqlmodel import Session, create_engine, select

from lib_softtrack.tables import (
    CustomField,
    CustomFieldKind,
    CustomFieldValue,
    Notification,
    NotificationKind,
    StatusCategory,
    Team,
    Ticket,
    TicketEvent,
    TicketEventField,
    User,
    WorkflowStatus,
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
    """A ticket with a status event and a notification, written as of AFTER."""
    with Session(engine) as session:
        session.add(Team(id=1, name="Engineering", key="ENG"))
        session.add(
            User(
                id=1,
                email="ada@softtrack.dev",
                username="ada",
                hashed_password="x",
                full_name="Ada",
            )
        )
        session.add(
            WorkflowStatus(
                id=1,
                team_id=1,
                name="Todo",
                category=StatusCategory.unstarted,
                position=0,
            )
        )
        session.flush()
        session.add(
            Ticket(id=1, team_id=1, number=1, title="Work", status_id=1, creator_id=1)
        )
        session.flush()
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

    with Session(engine) as session:
        field = CustomField(
            team_id=1,
            key="environment",
            name="Environment",
            kind=CustomFieldKind.select,
            options=[{"id": "production", "name": "Production"}],
            applies_to=["bug"],
        )
        session.add(field)
        session.flush()
        session.add(
            CustomFieldValue(ticket_id=1, field_id=field.id, value="production")
        )
        session.add(
            TicketEvent(
                ticket_id=1,
                team_id=1,
                field=TicketEventField.custom_field,
                custom_field_id=field.id,
                new_value="production",
                actor_id=1,
            )
        )
        session.add(
            Notification(
                user_id=1,
                kind=NotificationKind.field_assigned,
                ticket_id=1,
                custom_field_id=field.id,
            )
        )
        session.commit()

        value = session.exec(select(CustomFieldValue)).one()
        assert value.value == "production"
        assert session.get(CustomField, field.id).options == [
            {"id": "production", "name": "Production"}
        ]
    engine.dispose()

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
