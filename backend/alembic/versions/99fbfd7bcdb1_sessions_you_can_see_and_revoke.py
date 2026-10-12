"""sessions you can see and revoke

Revision ID: 99fbfd7bcdb1
Revises: 938713dbd818
Create Date: 2026-10-12

Issue #308: `authsession`, one row per signed-in browser, whose id a session
token carries as `sid`. Starts empty: tokens issued before it carry no `sid`
and keep working until they expire.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "99fbfd7bcdb1"
down_revision: Union[str, Sequence[str], None] = "938713dbd818"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "authsession",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("user_agent", sa.String(), nullable=False, server_default=""),
        sa.Column("ip_address", sa.String(), nullable=False, server_default=""),
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
        # Ids are never reused: a token names its session by id.
        sqlite_autoincrement=True,
    )
    with op.batch_alter_table("authsession", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_authsession_user_id"), ["user_id"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("authsession", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_authsession_user_id"))
    op.drop_table("authsession")
