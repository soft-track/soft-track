"""add departments

Revision ID: 48a7174ef49b
Revises: 24d062e0431b
Create Date: 2026-09-27

Issue #123: a `department` table a site admin fills in, and a nullable
`user.department_id` pointing at it. Every existing account comes out in no
department, which is what it was.

Names are unique whatever the case. The table carries `name_key`, the name
case-folded, under a unique constraint -- rather than a unique index on
`lower(name)`, which SQLAlchemy cannot reflect on SQLite: every later batch
migration that rebuilt `user` would warn about it. Autogenerate's usual offers
to drop the FTS5 tables and retype the trigger columns are left out, as in
the revisions before this one.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "48a7174ef49b"
down_revision: Union[str, Sequence[str], None] = "24d062e0431b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Autogenerate emitted this with `None` for a name, which batch mode on SQLite
# refuses when it rebuilds `user`. Named here.
_DEPARTMENT_FK = "fk_user_department_id_department"


def upgrade() -> None:
    op.create_table(
        "department",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("name_key", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name_key", name="uq_department_name_key"),
    )

    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.add_column(sa.Column("department_id", sa.Integer(), nullable=True))
        batch_op.create_index(
            batch_op.f("ix_user_department_id"), ["department_id"], unique=False
        )
        batch_op.create_foreign_key(
            _DEPARTMENT_FK, "department", ["department_id"], ["id"]
        )


def downgrade() -> None:
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.drop_constraint(_DEPARTMENT_FK, type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_user_department_id"))
        batch_op.drop_column("department_id")

    op.drop_table("department")
