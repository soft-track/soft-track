"""accounts created by a site admin

Revision ID: 938713dbd818
Revises: d4a7c2e9b815
Create Date: 2026-10-12

Issue #303: `user.is_activated`, false for an account a site admin created
whose owner has not chosen a password yet (true for every account there is:
each of them registered or signed in itself), and `passwordreset.emailed_at`,
whether the link to choose one was emailed or only handed to the admin.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "938713dbd818"
down_revision: Union[str, Sequence[str], None] = "d4a7c2e9b815"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_activated", sa.Boolean(), nullable=False, server_default=sa.true()
            )
        )
    with op.batch_alter_table("passwordreset", schema=None) as batch_op:
        batch_op.add_column(sa.Column("emailed_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("passwordreset", schema=None) as batch_op:
        batch_op.drop_column("emailed_at")
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.drop_column("is_activated")
