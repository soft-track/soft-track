"""add personal API tokens

Revision ID: 2d7f9b1e3a58
Revises: 1c6e8a0f4b27
Create Date: 2026-09-26

Issue #90. A new table and nothing else -- no existing row changes.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision: str = "2d7f9b1e3a58"
down_revision: Union[str, Sequence[str], None] = "1c6e8a0f4b27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "apitoken",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("token_hash", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("hint", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("apitoken", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_apitoken_token_hash"), ["token_hash"], unique=True
        )
        batch_op.create_index(batch_op.f("ix_apitoken_user_id"), ["user_id"])


def downgrade() -> None:
    with op.batch_alter_table("apitoken", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_apitoken_user_id"))
        batch_op.drop_index(batch_op.f("ix_apitoken_token_hash"))
    op.drop_table("apitoken")
