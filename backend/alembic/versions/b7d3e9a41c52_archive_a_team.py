"""archive a team

Revision ID: b7d3e9a41c52
Revises: ec512cd840ca
Create Date: 2026-10-12

Issue #307: `team.archived_at`, when a site admin archived the team from
Administration -> Teams. Null for every team there already is, which is
what they all are: in use.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "b7d3e9a41c52"
down_revision: Union[str, Sequence[str], None] = "ec512cd840ca"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("team") as batch_op:
        batch_op.add_column(sa.Column("archived_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("team") as batch_op:
        batch_op.drop_column("archived_at")
