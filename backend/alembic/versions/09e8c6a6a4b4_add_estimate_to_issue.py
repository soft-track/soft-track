"""add estimate to issue

Revision ID: 09e8c6a6a4b4
Revises: e2b56dbe1777
Create Date: 2026-09-07 18:44:26.560871

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "09e8c6a6a4b4"
# Chained onto the merge revision rather than the original baseline: issue
# links and search both landed on main first, and this migration has never
# been merged, so repointing it is free -- where rewriting a published
# migration's parent would not be.
down_revision: Union[str, Sequence[str], None] = "09d941255b48"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add story points to Issue.

    Nullable on purpose: null means "not sized yet", which a burndown has to
    be able to tell apart from an estimate of zero. Existing issues keep null
    and nothing has to be backfilled.
    """
    with op.batch_alter_table("issue", schema=None) as batch_op:
        batch_op.add_column(sa.Column("estimate", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Drop the column, and every estimate stored in it."""
    with op.batch_alter_table("issue", schema=None) as batch_op:
        batch_op.drop_column("estimate")
