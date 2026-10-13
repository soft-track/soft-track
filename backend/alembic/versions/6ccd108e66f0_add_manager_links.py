"""add manager links

Revision ID: 6ccd108e66f0
Revises: 48a7174ef49b
Create Date: 2026-09-27

Issue #124: `user.manager_id`, a nullable link from somebody to the person
they report to. Every existing account comes out reporting to nobody. The
rule that makes it safe -- no loops -- is the service's, checked when a link
is set, since a constraint cannot walk a chain.

Autogenerate's usual offers to drop the FTS5 tables and retype the trigger
columns are left out, as in the revisions before this one.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "6ccd108e66f0"
down_revision: Union[str, Sequence[str], None] = "48a7174ef49b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Autogenerate emitted this with `None` for a name, which batch mode on SQLite
# refuses when it rebuilds `user`. Named here.
_MANAGER_FK = "fk_user_manager_id_user"


def upgrade() -> None:
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.add_column(sa.Column("manager_id", sa.Integer(), nullable=True))
        batch_op.create_index(
            batch_op.f("ix_user_manager_id"), ["manager_id"], unique=False
        )
        batch_op.create_foreign_key(_MANAGER_FK, "user", ["manager_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.drop_constraint(_MANAGER_FK, type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_user_manager_id"))
        batch_op.drop_column("manager_id")
