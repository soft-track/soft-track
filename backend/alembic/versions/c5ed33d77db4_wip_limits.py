"""wip limits

Revision ID: c5ed33d77db4
Revises: 275db0819719
Create Date: 2026-10-04

Issue #270: `workflowstatus.wip_limit`, how many tickets a column should
hold, null for no limit; and on `team`, whether a limit refuses a move
(`wip_limits_hard`, off) and whether sub-tickets count against it
(`wip_counts_subtickets`, on). Every column has no limit after it, which is
how every board behaved before.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "c5ed33d77db4"
down_revision: Union[str, Sequence[str], None] = "275db0819719"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("workflowstatus", schema=None) as batch_op:
        batch_op.add_column(sa.Column("wip_limit", sa.Integer(), nullable=True))
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "wip_limits_hard",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.add_column(
            sa.Column(
                "wip_counts_subtickets",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.drop_column("wip_counts_subtickets")
        batch_op.drop_column("wip_limits_hard")
    with op.batch_alter_table("workflowstatus", schema=None) as batch_op:
        batch_op.drop_column("wip_limit")
