"""add employee profile fields

Revision ID: 24d062e0431b
Revises: 06abb8eb700e
Create Date: 2026-09-27

Issue #122: a profile carries what an organisation knows about a person --
`user.job_title`, `user.location` and `user.started_on`. All three nullable
with no default, so every existing account comes out with nothing filled in
and looks exactly as it did.

Autogenerate's usual offers to drop the FTS5 tables and retype the trigger
columns are left out, as in the revisions before this one.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "24d062e0431b"
down_revision: Union[str, Sequence[str], None] = "06abb8eb700e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("job_title", sqlmodel.sql.sqltypes.AutoString(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("location", sqlmodel.sql.sqltypes.AutoString(), nullable=True)
        )
        batch_op.add_column(sa.Column("started_on", sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.drop_column("started_on")
        batch_op.drop_column("location")
        batch_op.drop_column("job_title")
