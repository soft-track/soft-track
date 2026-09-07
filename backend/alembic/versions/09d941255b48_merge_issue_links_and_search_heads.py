"""merge issue links and search heads

Revision ID: 09d941255b48
Revises: 55613c0f041c, a3f1c9d24e70
Create Date: 2026-09-07

Issue links (#43) and full-text search (#44) each added a migration from the
same parent, and both were merged. That left two Alembic heads, and since the
app runs `alembic upgrade head` on startup, it meant a fresh database could
not be created at all:

    CommandError: Multiple head revisions are present for given argument
    'head'; please specify a specific target revision...

This revision does nothing except join the two branches back into one head.
No schema change -- the two migrations touch different tables and neither
needs the other.

A merge revision rather than repointing one migration's down_revision at the
other: both revision ids are already on main, and rewriting a published
migration's parent would strand anyone who had stamped one of them.
"""

from typing import Sequence, Union

revision: str = "09d941255b48"
down_revision: Union[str, Sequence[str], None] = ("55613c0f041c", "a3f1c9d24e70")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Nothing to do -- this revision exists only to rejoin the two branches."""


def downgrade() -> None:
    """Nothing to undo."""
