"""add comment reactions

Revision ID: 4b9d2e7a1c85
Revises: 8c4e1a7d2f93
Create Date: 2026-09-26 01:23:02.460442

One table, `commentreaction` (#96), and the `reactionemoji` type it uses.

Autogenerate also offered to drop the SQLite FTS5 tables and to change the
type of `automationrule.trigger` and `automationrun.trigger`. Both are the
noise earlier revisions describe: the FTS tables are virtual tables
5b8e2d4c9a17 creates with raw SQL and SQLModel's metadata cannot see, and the
trigger columns are the unconstrained VARCHAR explained in f4257f8963c4. Left
out on purpose.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "4b9d2e7a1c85"
down_revision: Union[str, Sequence[str], None] = "8c4e1a7d2f93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_EMOJI = (
    "thumbs_up",
    "thumbs_down",
    "laugh",
    "hooray",
    "confused",
    "heart",
    "rocket",
    "eyes",
)


def upgrade() -> None:
    """Add the reactions table."""
    op.create_table(
        "commentreaction",
        sa.Column("comment_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("emoji", sa.Enum(*_EMOJI, name="reactionemoji"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["comment_id"], ["comment.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        # Leads with comment_id, which is every read: a page of comments asks
        # for its reactions by comment. No separate index needed.
        sa.PrimaryKeyConstraint("comment_id", "user_id", "emoji"),
    )


def downgrade() -> None:
    """Remove the table, and on Postgres the type it created."""
    op.drop_table("commentreaction")
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Postgres does not drop a type when the last table using it goes.
        postgresql.ENUM(name="reactionemoji").drop(bind, checkfirst=True)
