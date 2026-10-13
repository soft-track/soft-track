"""add retired team key

Revision ID: e3f1a7c9b2d4
Revises: a9ae2c8b879d
Create Date: 2026-10-13

Issue #322: `retiredteamkey`, the key of a deleted team that had given out
identifiers. Keys are never given back -- `ENG-42` is in commit messages and
chat logs -- so creating a team with one is refused. A team deleted before its
first ticket leaves no row, and its key is free again.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision: str = "e3f1a7c9b2d4"
down_revision: Union[str, Sequence[str], None] = "a9ae2c8b879d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "retiredteamkey",
        sa.Column("key", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("retired_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("retiredteamkey")
