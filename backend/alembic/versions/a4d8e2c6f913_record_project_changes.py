"""record which project an issue moved into

Revision ID: a4d8e2c6f913
Revises: 3f1a9c7e2b64
Create Date: 2026-09-25

Issue #64. `issueevent` recorded status, cycle and estimate changes but not
project ones, so "how much did this epic grow after work started" had nothing
to replay. This adds `project` to the event field, and from here on every
change is recorded where the other three are.

One row per issue already in a project is written as part of the upgrade,
stamped with the time of the upgrade. That is a true statement -- "in this
project as of now" -- and not an invented one: it does not claim when the
issue joined. Without it, an epic whose issues were all filed before this
release would have no events at all, and its burnup would start at the first
issue moved afterwards and show that one issue as the epic's whole scope.
A chart that starts on upgrade day with the right scope is the honest version
of "start at the first recorded event".
"""

from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a4d8e2c6f913"
down_revision: Union[str, Sequence[str], None] = "3f1a9c7e2b64"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Committed on its own: Postgres refuses to use an enum value in the
        # transaction that added it, and the backfill below uses it. SQLite
        # stores the column as VARCHAR with no CHECK constraint, so there is
        # nothing to change there.
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE issueeventfield ADD VALUE IF NOT EXISTS 'project'")

    # In INSERT ... SELECT a bare literal resolves as text, and Postgres has
    # no implicit cast from text to an enum.
    field = (
        "CAST('project' AS issueeventfield)"
        if bind.dialect.name == "postgresql"
        else "'project'"
    )
    op.execute(
        sa.text(
            "INSERT INTO issueevent"
            " (issue_id, team_id, field, old_value, new_value, actor_id, created_at)"
            f" SELECT id, team_id, {field}, NULL, CAST(project_id AS VARCHAR),"
            " NULL, :now FROM issue WHERE project_id IS NOT NULL"
        ).bindparams(now=datetime.now(timezone.utc).replace(tzinfo=None))
    )


def downgrade() -> None:
    # The rows go; the enum value stays. Postgres cannot drop a value from an
    # enum without rebuilding the type, and an unused value is harmless.
    op.execute("DELETE FROM issueevent WHERE field = 'project'")
