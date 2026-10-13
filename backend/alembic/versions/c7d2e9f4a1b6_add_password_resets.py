"""add password resets

Revision ID: c7d2e9f4a1b6
Revises: b5e1f7a2c830
Create Date: 2026-09-25

Issue #83: "forgot password" links. A new table and nothing else -- no
existing row changes.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision: str = "c7d2e9f4a1b6"
down_revision: Union[str, Sequence[str], None] = "b5e1f7a2c830"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "passwordreset",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("token_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("passwordreset", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_passwordreset_token_hash"), ["token_hash"], unique=True
        )
        batch_op.create_index(
            batch_op.f("ix_passwordreset_user_id"), ["user_id"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("passwordreset", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_passwordreset_user_id"))
        batch_op.drop_index(batch_op.f("ix_passwordreset_token_hash"))
    op.drop_table("passwordreset")
