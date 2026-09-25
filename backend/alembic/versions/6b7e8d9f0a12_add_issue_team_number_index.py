"""add issue team number index

Revision ID: 6b7e8d9f0a12
Revises: c1a7f3d9b204
Create Date: 2026-09-15

"""

from typing import Sequence, Union

from alembic import op

revision: str = "6b7e8d9f0a12"
down_revision: Union[str, Sequence[str], None] = "c1a7f3d9b204"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_issue_team_number", "issue", ["team_id", "number"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_issue_team_number", table_name="issue")
