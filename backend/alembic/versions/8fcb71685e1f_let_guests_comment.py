"""let guests comment

Revision ID: 8fcb71685e1f
Revises: 45e4506be3db
Create Date: 2026-10-01

Issue #244: `team.guests_may_comment`, whether a team's guests may join the
conversation on its tickets. False for every team, which is what a guest
could do until now; a team admin turns it on.

`attachment.guest_draft` marks a file a guest uploaded for a comment, which
is not one of the ticket's until a comment claims it. False for every file
there is: no guest could upload before this.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "8fcb71685e1f"
down_revision: Union[str, Sequence[str], None] = "45e4506be3db"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # In place on SQLite: adding a column with a default rebuilds nothing, so
    # the tables whose triggers a rebuild would drop are not touched.
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "guests_may_comment",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
    with op.batch_alter_table("attachment", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "guest_draft",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("attachment", schema=None) as batch_op:
        batch_op.drop_column("guest_draft")
    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.drop_column("guests_may_comment")
