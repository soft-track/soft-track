"""add guest team role

Revision ID: 8c4e1a7d2f93
Revises: 3e8a0c2f5b69
Create Date: 2026-09-26 09:12:40.118204

One new value on the `teamrole` enum (#104), used by `teammember.role` and
`teaminvite.role`. No table changes.

Same shape as f4257f8963c4's trigger values, for the same reasons: on Postgres
the type constrains both columns and has to be widened with
`ALTER TYPE ... ADD VALUE`; on SQLite the column is a `VARCHAR(6)` with no
check constraint (the initial schema never asked for one), SQLite does not
enforce the length, and "guest" fits in it anyway. So there is nothing to do
there, and this revision deliberately does not rebuild two tables to say so.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8c4e1a7d2f93"
down_revision: Union[str, Sequence[str], None] = "3e8a0c2f5b69"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Widen `teamrole` on Postgres; SQLite needs nothing."""
    if op.get_bind().dialect.name == "postgresql":
        # IF NOT EXISTS so a partially-applied run can be repeated. Allowed in a
        # transaction since Postgres 12 because nothing here uses the value.
        op.execute("ALTER TYPE teamrole ADD VALUE IF NOT EXISTS 'guest'")


def downgrade() -> None:
    """Remove guests and invitations to be one; the enum label stays.

    Deleted rather than promoted to members: the code this downgrades to has no
    read-only role, and turning every guest into someone who can edit the team
    would grant access nobody granted. A guest who should stay can be re-added
    as a member by an admin; one who should not was never going to be.

    The label itself cannot be removed -- Postgres has no
    `ALTER TYPE ... DROP VALUE` -- and one unused label is harmless.
    """
    op.execute("DELETE FROM teaminvite WHERE role = 'guest'")
    op.execute("DELETE FROM teammember WHERE role = 'guest'")
