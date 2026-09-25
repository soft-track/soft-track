"""record assignee and priority changes, and mark opening values

Revision ID: b5e1f7a2c830
Revises: a4d8e2c6f913
Create Date: 2026-09-25

Issue #81 shows an issue's history on the issue itself. Two changes to the
history table make that possible:

1. `assignee` and `priority` join the event field. They are the changes
   people actually ask about -- who assigned it, who made it urgent -- and
   they were not being recorded. There is nothing to backfill: those changes
   were never written down.

2. `opening` marks the rows `record_creation` writes: the values an issue
   started with rather than changes to it. The reports need those rows; the
   Activity feed must leave them out. From here on they are marked as they are
   written. Rows already in the table are marked by the two rules that
   describe them:

   - a null old value within two seconds of the issue's first event -- the
     creation burst, all written in one transaction. This is a best guess
     applied once to old data; nothing after this upgrade relies on it;
   - a `project` row with a null old value and no actor. Automation rules
     cannot set a project, so the only such rows are the ones a4d8e2c6f913
     wrote to record where every issue stood at that upgrade.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "b5e1f7a2c830"
down_revision: Union[str, Sequence[str], None] = "a4d8e2c6f913"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    postgres = bind.dialect.name == "postgresql"
    if postgres:
        # Outside the migration's transaction, as in a4d8e2c6f913. SQLite
        # stores the column as VARCHAR with no CHECK constraint -- nothing to
        # change there.
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE issueeventfield ADD VALUE IF NOT EXISTS 'assignee'")
            op.execute("ALTER TYPE issueeventfield ADD VALUE IF NOT EXISTS 'priority'")

    # A server default so existing rows get a value, dropped in a second batch
    # -- see d8c2a6f41e93 for why that has to be two batches on SQLite.
    with op.batch_alter_table("issueevent", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "opening", sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )

    two_seconds_after = (
        "first.at + INTERVAL '2 seconds'"
        if postgres
        else "datetime(first.at, '+2 seconds')"
    )
    op.execute(
        "UPDATE issueevent SET opening = TRUE WHERE old_value IS NULL AND ("
        " (field = 'project' AND actor_id IS NULL)"
        " OR created_at <= ("
        f"   SELECT {two_seconds_after} FROM ("
        "     SELECT MIN(e.created_at) AS at FROM issueevent e"
        "     WHERE e.issue_id = issueevent.issue_id"
        "   ) AS first"
        " )"
        ")"
    )

    with op.batch_alter_table("issueevent", schema=None) as batch_op:
        batch_op.alter_column(
            "opening", existing_type=sa.Boolean(), server_default=None
        )


def downgrade() -> None:
    with op.batch_alter_table("issueevent", schema=None) as batch_op:
        batch_op.drop_column("opening")
    # The rows go; the enum values stay. Postgres cannot drop a value from an
    # enum without rebuilding the type, and an unused one is harmless.
    op.execute("DELETE FROM issueevent WHERE field IN ('assignee', 'priority')")
