"""add custom fields

Revision ID: cf3f72037267
Revises: 3309e3a2ef3f
Create Date: 2026-09-30

Issue #117: fields a team defines for its own tickets. `customfield` is the
definition -- key, name, kind, options, required, the ticket types it
applies to, order, archived -- and `customfieldvalue` one ticket's value for
one field, as JSON (`jsonb` on Postgres).

Two existing tables learn to point at a field: `ticketevent`, so a change to
one reads back in the Activity feed, and `notification`, so being named in a
user field can say which field. Each gets a nullable `custom_field_id` and
its enum a value -- `custom_field` and `field_assigned` -- added outside the
transaction on Postgres and not at all on SQLite, the way 9d3f6b1e8a24 added
`team`. Autogenerate's usual offers to drop the FTS5 tables and retype the
trigger columns are left out, as in the revisions before this one.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "cf3f72037267"
down_revision: Union[str, Sequence[str], None] = "3309e3a2ef3f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Named rather than left to autogenerate's `None`, which batch mode on SQLite
# refuses when it rebuilds a table.
_EVENT_FK = "fk_ticketevent_custom_field_id_customfield"
_NOTIFICATION_FK = "fk_notification_custom_field_id_customfield"


def _json() -> sa.types.TypeEngine:
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute(
                "ALTER TYPE ticketeventfield ADD VALUE IF NOT EXISTS 'custom_field'"
            )
            op.execute(
                "ALTER TYPE notificationkind ADD VALUE IF NOT EXISTS 'field_assigned'"
            )

    op.create_table(
        "customfield",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("key", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "text",
                "number",
                "select",
                "multi_select",
                "user",
                "date",
                "checkbox",
                "url",
                name="customfieldkind",
            ),
            nullable=False,
        ),
        sa.Column("options", _json(), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False),
        sa.Column("applies_to", _json(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["team_id"], ["team.id"], name="fk_customfield_team_id_team"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("team_id", "key", name="uq_custom_field_team_key"),
    )
    with op.batch_alter_table("customfield", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_customfield_team_id"), ["team_id"], unique=False
        )

    op.create_table(
        "customfieldvalue",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("field_id", sa.Integer(), nullable=False),
        sa.Column("value", _json(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["field_id"],
            ["customfield.id"],
            name="fk_customfieldvalue_field_id_customfield",
        ),
        sa.ForeignKeyConstraint(
            ["ticket_id"], ["ticket.id"], name="fk_customfieldvalue_ticket_id_ticket"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ticket_id", "field_id", name="uq_custom_field_value"),
    )
    with op.batch_alter_table("customfieldvalue", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_customfieldvalue_field_id"), ["field_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_customfieldvalue_ticket_id"), ["ticket_id"], unique=False
        )

    with op.batch_alter_table("ticketevent", schema=None) as batch_op:
        batch_op.add_column(sa.Column("custom_field_id", sa.Integer(), nullable=True))
        batch_op.create_index(
            batch_op.f("ix_ticketevent_custom_field_id"),
            ["custom_field_id"],
            unique=False,
        )
        batch_op.create_foreign_key(
            _EVENT_FK, "customfield", ["custom_field_id"], ["id"]
        )

    with op.batch_alter_table("notification", schema=None) as batch_op:
        batch_op.add_column(sa.Column("custom_field_id", sa.Integer(), nullable=True))
        batch_op.create_index(
            batch_op.f("ix_notification_custom_field_id"),
            ["custom_field_id"],
            unique=False,
        )
        batch_op.create_foreign_key(
            _NOTIFICATION_FK, "customfield", ["custom_field_id"], ["id"]
        )


def downgrade() -> None:
    """Take the fields off, and everything that pointed at them.

    The code this goes back to cannot read a `custom_field` event or a
    `field_assigned` notification, so they go before the columns naming the
    field. The labels stay on the Postgres types, which have no DROP VALUE.
    """
    op.execute("DELETE FROM ticketevent WHERE field = 'custom_field'")
    op.execute("DELETE FROM notification WHERE kind = 'field_assigned'")

    with op.batch_alter_table("notification", schema=None) as batch_op:
        batch_op.drop_constraint(_NOTIFICATION_FK, type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_notification_custom_field_id"))
        batch_op.drop_column("custom_field_id")

    with op.batch_alter_table("ticketevent", schema=None) as batch_op:
        batch_op.drop_constraint(_EVENT_FK, type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_ticketevent_custom_field_id"))
        batch_op.drop_column("custom_field_id")

    with op.batch_alter_table("customfieldvalue", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_customfieldvalue_ticket_id"))
        batch_op.drop_index(batch_op.f("ix_customfieldvalue_field_id"))
    op.drop_table("customfieldvalue")

    with op.batch_alter_table("customfield", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_customfield_team_id"))
    op.drop_table("customfield")
    sa.Enum(name="customfieldkind").drop(op.get_bind(), checkfirst=True)
