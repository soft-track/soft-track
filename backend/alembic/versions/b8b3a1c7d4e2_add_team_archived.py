"""add team archived flag

Revision ID: b8b3a1c7d4e2
Revises: c5ed33d77db4
Create Date: 2026-10-02

Every existing team is new and active by default, so the archive flag is backfilled to
false rather than leaving an uninitialized column behind. This is the lifecycle field for
issue #322 and is intentionally separate from deletion.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "b8b3a1c7d4e2"
down_revision: Union[str, Sequence[str], None] = "c5ed33d77db4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "archived",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.drop_column("archived")
