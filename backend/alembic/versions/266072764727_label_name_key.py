"""label names unique per team, whatever the case

Revision ID: 266072764727
Revises: cf3f72037267
Create Date: 2026-10-01

Issue #321: labels can be renamed, and a label's name is unique on its team
whatever the case, the way department names are. `label.name_key` is the
name trimmed and case-folded, under a unique constraint with `team_id` --
a column rather than an index on `lower(name)`, for the reason
48a7174ef49b gives.

Nothing refused a second "bug" beside "Bug" before, so a team may already
have one. The constraint cannot go on over them, so each set is merged into
its oldest label first: the tickets that carry any of them, the saved views
that filter by them and the automation rules that name them move to that
one, and the rest are deleted. A merge cannot be taken apart again, so the
downgrade drops the column and leaves the merged labels merged.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # autogenerate emits sqlmodel.sql.sqltypes.AutoString()

# revision identifiers, used by Alembic.
revision: str = "266072764727"
down_revision: Union[str, Sequence[str], None] = "cf3f72037267"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_UNIQUE = "uq_label_team_name_key"

# The tables as this revision sees them, not as the models say they are now.
_label = sa.table(
    "label",
    sa.column("id", sa.Integer),
    sa.column("team_id", sa.Integer),
    sa.column("name", sa.String),
    sa.column("name_key", sa.String),
)
_link = sa.table(
    "ticketlabellink",
    sa.column("ticket_id", sa.Integer),
    sa.column("label_id", sa.Integer),
)
_view = sa.table("savedview", sa.column("label_id", sa.Integer))
_rule = sa.table(
    "automationrule",
    sa.column("if_label_id", sa.Integer),
    sa.column("add_label_id", sa.Integer),
)


def upgrade() -> None:
    with op.batch_alter_table("label", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("name_key", sqlmodel.sql.sqltypes.AutoString(), nullable=True)
        )

    bind = op.get_bind()
    oldest: dict[tuple[int, str], int] = {}
    for label_id, team_id, name in bind.execute(
        sa.select(_label.c.id, _label.c.team_id, _label.c.name).order_by(_label.c.id)
    ).all():
        # Case-folded in Python: SQLite's lower() folds ASCII only.
        key = name.strip().casefold()
        survivor = oldest.setdefault((team_id, key), label_id)
        if survivor == label_id:
            bind.execute(
                _label.update().where(_label.c.id == label_id).values(name_key=key)
            )
        else:
            _merge(bind, label_id, into=survivor)

    with op.batch_alter_table("label", schema=None) as batch_op:
        batch_op.alter_column(
            "name_key",
            existing_type=sqlmodel.sql.sqltypes.AutoString(),
            nullable=False,
        )
        batch_op.create_unique_constraint(_UNIQUE, ["team_id", "name_key"])


def _merge(bind, duplicate: int, into: int) -> None:
    """Move everything that points at `duplicate` to `into`, then drop it."""
    # A ticket carrying both keeps the one link it is allowed.
    carried = sa.select(_link.c.ticket_id).where(_link.c.label_id == into)
    bind.execute(
        _link.delete().where(
            _link.c.label_id == duplicate, _link.c.ticket_id.in_(carried)
        )
    )
    bind.execute(
        _link.update().where(_link.c.label_id == duplicate).values(label_id=into)
    )
    bind.execute(
        _view.update().where(_view.c.label_id == duplicate).values(label_id=into)
    )
    bind.execute(
        _rule.update().where(_rule.c.if_label_id == duplicate).values(if_label_id=into)
    )
    bind.execute(
        _rule.update()
        .where(_rule.c.add_label_id == duplicate)
        .values(add_label_id=into)
    )
    bind.execute(_label.delete().where(_label.c.id == duplicate))


def downgrade() -> None:
    with op.batch_alter_table("label", schema=None) as batch_op:
        batch_op.drop_constraint(_UNIQUE, type_="unique")
        batch_op.drop_column("name_key")
