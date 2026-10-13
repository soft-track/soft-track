"""record when an invitation was emailed

Revision ID: d3a8b1c5e270
Revises: c7d2e9f4a1b6
Create Date: 2026-09-25

Issue #84. A nullable column, null for every existing invitation: none of
them were ever emailed.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "d3a8b1c5e270"
down_revision: Union[str, Sequence[str], None] = "c7d2e9f4a1b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("teaminvite", schema=None) as batch_op:
        batch_op.add_column(sa.Column("emailed_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("teaminvite", schema=None) as batch_op:
        batch_op.drop_column("emailed_at")
