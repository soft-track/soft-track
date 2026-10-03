"""people from outside the organisation

Revision ID: 7fb73fe53e97
Revises: 8fcb71685e1f
Create Date: 2026-10-04

Issue #243: `user.is_external`, an account from outside the organisation;
`guestepic`, the epics such an account may see on a team; and
`teaminvite.external` / `teaminvite.epic_ids`, the same two things chosen on
the invitation before there is an account to put them on.

False and empty for every row there is: nobody was outside until now.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "7fb73fe53e97"
down_revision: Union[str, Sequence[str], None] = "8fcb71685e1f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Added in place on SQLite, like 8fcb71685e1f: a column with a default
    # rebuilds nothing.
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_external", sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )

    op.create_table(
        "guestepic",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["user.id"], name="fk_guestepic_user_id_user"
        ),
        sa.ForeignKeyConstraint(
            ["project_id"], ["project.id"], name="fk_guestepic_project_id_project"
        ),
        sa.PrimaryKeyConstraint("user_id", "project_id"),
    )
    with op.batch_alter_table("guestepic", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_guestepic_project_id"), ["project_id"], unique=False
        )

    with op.batch_alter_table("teaminvite", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "external", sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )
        batch_op.add_column(
            sa.Column(
                "epic_ids",
                sa.JSON().with_variant(postgresql.JSONB(), "postgresql"),
                nullable=False,
                server_default="[]",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("teaminvite", schema=None) as batch_op:
        batch_op.drop_column("epic_ids")
        batch_op.drop_column("external")

    with op.batch_alter_table("guestepic", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_guestepic_project_id"))
    op.drop_table("guestepic")

    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.drop_column("is_external")
