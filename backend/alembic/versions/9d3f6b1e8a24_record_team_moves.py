"""record moves between teams

Revision ID: 9d3f6b1e8a24
Revises: 6e2a9c4f7d10
Create Date: 2026-09-26 03:02:17.540932

One value on `issueeventfield`, `team` (#98): an issue moving from ENG-42 to
OPS-17 is recorded as a change to its team, keys as the old and new values.
Added the way a4d8e2c6f913 and b5e1f7a2c830 added theirs -- outside the
migration's transaction on Postgres, and nothing at all on SQLite, where the
column is an unconstrained VARCHAR.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9d3f6b1e8a24"
down_revision: Union[str, Sequence[str], None] = "6e2a9c4f7d10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE issueeventfield ADD VALUE IF NOT EXISTS 'team'")


def downgrade() -> None:
    """Forget the move events; the moves themselves stand.

    The code this goes back to cannot read a `team` event, so they go. The
    issues stay on the teams they were moved to, and each still has its
    "Moved from ENG-42" comment, which is what anyone reads anyway. The label
    stays on the Postgres type, which has no DROP VALUE.
    """
    op.execute("DELETE FROM issueevent WHERE field = 'team'")
