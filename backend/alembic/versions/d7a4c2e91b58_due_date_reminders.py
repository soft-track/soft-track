"""due-date reminders

Revision ID: d7a4c2e91b58
Revises: b5d1e7a3c942
Create Date: 2026-10-12

Issue #262: a ticket's due date reminds its assignee the day before and the
day after, and once more a week later.

`notificationkind` gains `due_tomorrow` and `overdue`, added outside the
transaction on Postgres and not at all on SQLite, the way cf3f72037267 added
`field_assigned`. A notification can say which due date it was about
(`due_date`, nullable: nothing else has one). `duereminder` is the record of
which reminders were claimed, keyed by ticket, person, date and stage, so each
goes out once however many workers run the sweep.

The downgrade drops the reminders and both additions. The labels stay on the
Postgres type, which has no DROP VALUE.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision: str = "d7a4c2e91b58"
down_revision: Union[str, Sequence[str], None] = "b5d1e7a3c942"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute(
                "ALTER TYPE notificationkind ADD VALUE IF NOT EXISTS 'due_tomorrow'"
            )
            op.execute("ALTER TYPE notificationkind ADD VALUE IF NOT EXISTS 'overdue'")

    op.create_table(
        "duereminder",
        sa.Column("ticket_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("stage", sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
        sa.Column("claimed_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["ticket_id"], ["ticket.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("ticket_id", "user_id", "due_date", "stage"),
    )
    with op.batch_alter_table("notification", schema=None) as batch_op:
        batch_op.add_column(sa.Column("due_date", sa.Date(), nullable=True))


def downgrade() -> None:
    """The code this goes back to cannot read a reminder, so they go first."""
    op.execute("DELETE FROM notification WHERE kind IN ('due_tomorrow', 'overdue')")
    with op.batch_alter_table("notification", schema=None) as batch_op:
        batch_op.drop_column("due_date")
    op.drop_table("duereminder")
