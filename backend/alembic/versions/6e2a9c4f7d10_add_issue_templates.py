"""add issue templates

Revision ID: 6e2a9c4f7d10
Revises: 4b9d2e7a1c85
Create Date: 2026-09-26 02:04:51.318077

One table, `issuetemplate` (#97). As in 4b9d2e7a1c85, autogenerate's offers to
drop the FTS5 virtual tables and retype the automation trigger columns are
left out on purpose.

The unique constraint is on the exact name. Case-insensitive uniqueness --
"Bug report" and "bug report" -- is the service's job, because a
case-insensitive index is spelled differently on every database.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "6e2a9c4f7d10"
down_revision: Union[str, Sequence[str], None] = "4b9d2e7a1c85"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add the templates table."""
    op.create_table(
        "issuetemplate",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("body", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["team_id"], ["team.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("team_id", "name", name="uq_issue_template_team_name"),
    )
    with op.batch_alter_table("issuetemplate", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_issuetemplate_team_id"), ["team_id"], unique=False
        )


def downgrade() -> None:
    """Remove the table. The issues filed from templates keep their text."""
    with op.batch_alter_table("issuetemplate", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_issuetemplate_team_id"))
    op.drop_table("issuetemplate")
