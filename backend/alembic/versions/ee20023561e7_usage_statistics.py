"""usage statistics for the instance

Revision ID: ee20023561e7
Revises: c2a1b3d45e67
Create Date: 2026-11-04

Issue #312: `mailattempt`, one row per message handed to the mail server --
when, and what the server said if it refused -- so Administration -> Usage
can count what went out. No address, subject or body. Starts empty: nothing
recorded sends before it. And an index on `ticket.created_at`, so the page
counts the tickets created each week without reading the whole table.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision: str = "ee20023561e7"
down_revision: Union[str, Sequence[str], None] = "c2a1b3d45e67"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mailattempt",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("attempted_at", sa.DateTime(), nullable=False),
        sa.Column("error", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("recipients", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("mailattempt", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_mailattempt_attempted_at"), ["attempted_at"], unique=False
        )
    # Not in a batch: an index alone needs no rebuild of the table, and a
    # rebuild would take the search triggers on it with it.
    op.create_index("ix_ticket_created_at", "ticket", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ticket_created_at", table_name="ticket")
    with op.batch_alter_table("mailattempt", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_mailattempt_attempted_at"))
    op.drop_table("mailattempt")
