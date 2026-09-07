"""add parent_id to issue

Revision ID: 78b80bc56bda
Revises: e2b56dbe1777
Create Date: 2026-09-07

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "78b80bc56bda"
# Chained onto main's current head rather than the original baseline: issue
# links, search and estimates all landed first. Safe to repoint because this
# migration has never been on main, so no database has stamped it -- rewriting
# a published migration's parent would be a different matter.
down_revision: Union[str, Sequence[str], None] = "09e8c6a6a4b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Autogenerate emitted this foreign key with `None` for the name, which
# batch mode on SQLite refuses ("Constraint must have a name") because it
# rebuilds the table and has nothing to call the constraint. Named here.
_PARENT_FK = "fk_issue_parent_id_issue"


def upgrade() -> None:
    """Add the self-referencing parent link.

    Nullable, and left without ON DELETE behaviour on purpose: deleting a
    parent promotes its children to top level rather than deleting them, and
    that decision belongs in the service where it can be explained, not in a
    constraint that would silently do something else.
    """
    with op.batch_alter_table("issue", schema=None) as batch_op:
        batch_op.add_column(sa.Column("parent_id", sa.Integer(), nullable=True))
        batch_op.create_index(
            batch_op.f("ix_issue_parent_id"), ["parent_id"], unique=False
        )
        batch_op.create_foreign_key(_PARENT_FK, "issue", ["parent_id"], ["id"])


def downgrade() -> None:
    """Drop the column, flattening every parent/child relationship."""
    with op.batch_alter_table("issue", schema=None) as batch_op:
        batch_op.drop_constraint(_PARENT_FK, type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_issue_parent_id"))
        batch_op.drop_column("parent_id")
