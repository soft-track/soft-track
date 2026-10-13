"""add worklogs

Revision ID: 2a7c5e9b4f16
Revises: 9d3f6b1e8a24
Create Date: 2026-09-26 04:11:52.604813

One table, `worklog` (#102): minutes somebody spent on an issue on a given
day. Autogenerate's usual offers to drop the FTS5 tables and retype the
trigger columns are left out, as in the revisions before this one.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "2a7c5e9b4f16"
down_revision: Union[str, Sequence[str], None] = "9d3f6b1e8a24"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add the worklog table."""
    op.create_table(
        "worklog",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("issue_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=False),
        sa.Column("worked_on", sa.Date(), nullable=False),
        sa.Column("note", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["issue_id"], ["issue.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("worklog", schema=None) as batch_op:
        # By issue for the panel, by user for "my time", by day for reports.
        batch_op.create_index(
            batch_op.f("ix_worklog_issue_id"), ["issue_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_worklog_user_id"), ["user_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_worklog_worked_on"), ["worked_on"], unique=False
        )


def downgrade() -> None:
    """Remove the table, and every hour logged in it."""
    with op.batch_alter_table("worklog", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_worklog_worked_on"))
        batch_op.drop_index(batch_op.f("ix_worklog_user_id"))
        batch_op.drop_index(batch_op.f("ix_worklog_issue_id"))
    op.drop_table("worklog")
