"""add outbound webhooks and their delivery log

Revision ID: 3e8a0c2f5b69
Revises: 2d7f9b1e3a58
Create Date: 2026-09-26

Issue #91. Two new tables and nothing else -- no existing row changes.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision: str = "3e8a0c2f5b69"
down_revision: Union[str, Sequence[str], None] = "2d7f9b1e3a58"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STRING = sqlmodel.sql.sqltypes.AutoString


def upgrade() -> None:
    op.create_table(
        "outboundwebhook",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("url", _STRING(), nullable=False),
        sa.Column("secret", _STRING(), nullable=False),
        sa.Column("events", _STRING(), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False),
        sa.Column("consecutive_failures", sa.Integer(), nullable=False),
        sa.Column("disabled_reason", _STRING(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["team_id"], ["team.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("outboundwebhook", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_outboundwebhook_team_id"), ["team_id"])

    op.create_table(
        "webhookdelivery",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("webhook_id", sa.Integer(), nullable=False),
        sa.Column("event", _STRING(), nullable=False),
        sa.Column("payload", _STRING(), nullable=False),
        sa.Column("status", _STRING(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("claimed_until", sa.DateTime(), nullable=True),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("response_excerpt", _STRING(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["webhook_id"], ["outboundwebhook.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("webhookdelivery", schema=None) as batch_op:
        for column in ("webhook_id", "status", "next_attempt_at", "created_at"):
            batch_op.create_index(batch_op.f(f"ix_webhookdelivery_{column}"), [column])


def downgrade() -> None:
    op.drop_table("webhookdelivery")
    op.drop_table("outboundwebhook")
