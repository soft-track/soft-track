"""time estimates in hours

Revision ID: a9c3e5d71f42
Revises: e3b8f1c64a27
Create Date: 2026-10-12

Issue #268: an optional time estimate on a ticket, in minutes, beside its
points; remaining time when somebody has set it by hand; and what a team
estimates in -- points, hours or both -- with points the default, so every
team there already is sees no change.

History gets `time_estimate` and `remaining` fields for the burndown in
hours, added outside the transaction on Postgres and not at all on SQLite,
the way e3b8f1c64a27 added `schedule`.

The downgrade drops the columns, the type and that history. The labels stay
on the Postgres history type, which has no DROP VALUE.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a9c3e5d71f42"
down_revision: Union[str, Sequence[str], None] = "e3b8f1c64a27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_UNIT = sa.Enum("points", "hours", "both", name="estimateunit")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            for value in ("time_estimate", "remaining"):
                op.execute(
                    f"ALTER TYPE ticketeventfield ADD VALUE IF NOT EXISTS '{value}'"
                )
    _UNIT.create(bind, checkfirst=True)

    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("estimate_unit", _UNIT, nullable=False, server_default="points")
        )
    with op.batch_alter_table("ticket", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("time_estimate_minutes", sa.Integer(), nullable=True)
        )
        batch_op.add_column(sa.Column("remaining_minutes", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.execute("DELETE FROM ticketevent WHERE field IN ('time_estimate', 'remaining')")
    with op.batch_alter_table("ticket", schema=None) as batch_op:
        batch_op.drop_column("remaining_minutes")
        batch_op.drop_column("time_estimate_minutes")
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.drop_column("estimate_unit")
    _UNIT.drop(op.get_bind(), checkfirst=True)
