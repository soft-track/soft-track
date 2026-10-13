"""recurring tickets

Revision ID: e3b8f1c64a27
Revises: d7a4c2e91b58
Create Date: 2026-10-12

Issue #264: work that comes back on a schedule. `ticketschedule` is what a
schedule creates and when; `schedulerun` is each occurrence it has claimed,
keyed by schedule and day so each makes one ticket however many workers run
the sweep, and the ticket it made.

History gets a `schedule` field for "created by the schedule ...", added
outside the transaction on Postgres and not at all on SQLite, the way
45e4506be3db added `trash`. The ticket and priority columns use the types
that are already there.

The downgrade drops both tables and that history. The label stays on the
Postgres type, which has no DROP VALUE.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e3b8f1c64a27"
down_revision: Union[str, Sequence[str], None] = "d7a4c2e91b58"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def _existing_enum(name: str, *values: str):
    """A type an earlier migration created: see 816a5f43eb02 for why
    `create_type=False` on Postgres."""
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.ENUM(*values, name=name, create_type=False)
    return sa.Enum(*values, name=name)


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE ticketeventfield ADD VALUE IF NOT EXISTS 'schedule'")

    op.create_table(
        "ticketschedule",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column(
            "title", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False
        ),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column(
            "type",
            _existing_enum("tickettype", "bug", "task", "story"),
            nullable=False,
            server_default="task",
        ),
        sa.Column(
            "priority",
            _existing_enum(
                "ticketpriority", "no_priority", "urgent", "high", "medium", "low"
            ),
            nullable=False,
            server_default="no_priority",
        ),
        sa.Column("assignee_id", sa.Integer(), nullable=True),
        sa.Column("label_ids", _JSON, nullable=False, server_default="[]"),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("estimate", sa.Integer(), nullable=True),
        sa.Column("due_after_days", sa.Integer(), nullable=True),
        sa.Column(
            "into_active_sprint",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "frequency", sqlmodel.sql.sqltypes.AutoString(length=10), nullable=False
        ),
        sa.Column("interval", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("weekdays", _JSON, nullable=False, server_default="[]"),
        sa.Column(
            "month_day", sqlmodel.sql.sqltypes.AutoString(length=20), nullable=True
        ),
        sa.Column("day_of_month", sa.Integer(), nullable=True),
        sa.Column("month", sa.Integer(), nullable=True),
        sa.Column(
            "wait_for_previous",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("active_since", sa.Date(), nullable=False),
        sa.Column("paused_at", sa.DateTime(), nullable=True),
        sa.Column("paused_by_id", sa.Integer(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["assignee_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["paused_by_id"], ["user.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"]),
        sa.ForeignKeyConstraint(["team_id"], ["team.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("ticketschedule", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_ticketschedule_team_id"), ["team_id"], unique=False
        )

    op.create_table(
        "schedulerun",
        sa.Column("schedule_id", sa.Integer(), nullable=False),
        sa.Column("occurs_on", sa.Date(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["schedule_id"], ["ticketschedule.id"]),
        sa.ForeignKeyConstraint(["ticket_id"], ["ticket.id"]),
        sa.PrimaryKeyConstraint("schedule_id", "occurs_on"),
    )
    with op.batch_alter_table("schedulerun", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_schedulerun_ticket_id"), ["ticket_id"], unique=False
        )


def downgrade() -> None:
    """The code this goes back to cannot read the history line, so it goes."""
    op.execute("DELETE FROM ticketevent WHERE field = 'schedule'")
    with op.batch_alter_table("schedulerun", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_schedulerun_ticket_id"))
    op.drop_table("schedulerun")
    with op.batch_alter_table("ticketschedule", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_ticketschedule_team_id"))
    op.drop_table("ticketschedule")
