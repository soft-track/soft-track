"""add share links

Revision ID: 8ed7f5a5441d
Revises: 7fb73fe53e97
Create Date: 2026-10-04

Issue #245: `sharelink`, a read-only link to an epic or a saved view for
somebody with no account. Only the token's hash is stored.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "8ed7f5a5441d"
down_revision: Union[str, Sequence[str], None] = "7fb73fe53e97"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sharelink",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("view_id", sa.Integer(), nullable=True),
        sa.Column("token_hash", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("password_hash", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("show_comments", sa.Boolean(), nullable=False),
        sa.Column("show_assignees", sa.Boolean(), nullable=False),
        sa.Column("show_estimates", sa.Boolean(), nullable=False),
        sa.Column("show_attachments", sa.Boolean(), nullable=False),
        sa.Column("open_count", sa.Integer(), nullable=False),
        sa.Column("last_opened_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["team_id"], ["team.id"], name="fk_sharelink_team_id_team"
        ),
        sa.ForeignKeyConstraint(
            ["project_id"], ["project.id"], name="fk_sharelink_project_id_project"
        ),
        sa.ForeignKeyConstraint(
            ["view_id"], ["savedview.id"], name="fk_sharelink_view_id_savedview"
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"], ["user.id"], name="fk_sharelink_created_by_id_user"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("sharelink", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_sharelink_team_id"), ["team_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_sharelink_token_hash"), ["token_hash"], unique=True
        )


def downgrade() -> None:
    with op.batch_alter_table("sharelink", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_sharelink_token_hash"))
        batch_op.drop_index(batch_op.f("ix_sharelink_team_id"))
    op.drop_table("sharelink")
