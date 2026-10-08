"""add timer

Revision ID: b2e5a8f15fc9
Revises: c5ed33d77db4
Create Date: 2026-10-07 18:27:11.857572

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "b2e5a8f15fc9"
down_revision: Union[str, Sequence[str], None] = "c5ed33d77db4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "timer",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column(
            "ticket_team_key",
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=False,
        ),
        sa.Column("ticket_number", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("last_started_at", sa.DateTime(), nullable=False),
        sa.Column("accumulated_seconds", sa.Integer(), nullable=False),
        sa.Column("paused_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["ticket_id"], ["ticket.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_timer_user_id"),
    )
    op.create_index("ix_timer_ticket_id", "timer", ["ticket_id"], unique=False)
    op.create_index("ix_timer_user_id", "timer", ["user_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_timer_user_id", table_name="timer")
    op.drop_index("ix_timer_ticket_id", table_name="timer")
    op.drop_table("timer")
