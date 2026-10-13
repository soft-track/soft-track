"""add finance admins

Revision ID: 042116f2d4de
Revises: 6ccd108e66f0
Create Date: 2026-09-29

Issue #130: `user.is_finance_admin`, the flag every finance endpoint checks,
and when and by whom the access somebody holds was granted. Every existing
account comes out without it, the site admins included -- that is the point:
nobody sees money until a site admin gives them the flag.

The boolean arrives with a server default so the ALTER succeeds on a table
with rows in it, and loses it in a second batch, as `is_site_admin` did in
b7d3e91a5c04: the model has no default in the database. Autogenerate's usual
offers to drop the FTS5 tables and retype the trigger columns are left out,
as in the revisions before this one.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "042116f2d4de"
down_revision: Union[str, Sequence[str], None] = "6ccd108e66f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Autogenerate emitted this with `None` for a name, which batch mode on SQLite
# refuses when it rebuilds `user`. Named here.
_GRANTED_BY_FK = "fk_user_finance_admin_granted_by_id_user"


def upgrade() -> None:
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_finance_admin",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.add_column(
            sa.Column("finance_admin_since", sa.DateTime(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("finance_admin_granted_by_id", sa.Integer(), nullable=True)
        )
        batch_op.create_foreign_key(
            _GRANTED_BY_FK, "user", ["finance_admin_granted_by_id"], ["id"]
        )

    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.alter_column(
            "is_finance_admin", existing_type=sa.Boolean(), server_default=None
        )


def downgrade() -> None:
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.drop_constraint(_GRANTED_BY_FK, type_="foreignkey")
        batch_op.drop_column("finance_admin_granted_by_id")
        batch_op.drop_column("finance_admin_since")
        batch_op.drop_column("is_finance_admin")
