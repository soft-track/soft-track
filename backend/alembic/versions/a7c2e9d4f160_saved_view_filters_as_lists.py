"""saved views filter on lists

Revision ID: a7c2e9d4f160
Revises: 99fbfd7bcdb1
Create Date: 2026-10-12

Issue #260: each of a saved view's status, priority, assignee, label and type
filters becomes a list, with a switch to exclude, and labels can be matched
any or all. The single-value columns go; each stored value becomes a list of
one, so every view opens on the tickets it always did.

The lists are JSON (`jsonb` on Postgres), which takes the foreign keys on
`status_id`, `assignee_id` and `label_id` with them; see the SavedView
docstring for where that responsibility now lives.

The downgrade keeps the first value of each list and drops the switches. A
view saved as "not Done" comes back as "Done", which is the most a single
column can say -- so is a downgrade after people have used the feature.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "a7c2e9d4f160"
down_revision: Union[str, Sequence[str], None] = "99fbfd7bcdb1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = sa.JSON().with_variant(JSONB(), "postgresql")

#: Old single column -> new list column.
_LISTS = (
    ("status_id", "status_ids"),
    ("priority", "priorities"),
    ("assignee_id", "assignee_ids"),
    ("label_id", "label_ids"),
    ("type", "types"),
)
_SWITCHES = (
    "status_exclude",
    "priority_exclude",
    "assignee_exclude",
    "label_all",
    "label_exclude",
    "type_exclude",
)
_FKS = (
    ("fk_savedview_status_id_workflowstatus", "status_id", "workflowstatus"),
    ("fk_savedview_assignee_id_user", "assignee_id", "user"),
    ("fk_savedview_label_id_label", "label_id", "label"),
)


def _existing_enum(name: str, *values: str):
    """An enum type the ticket table already has -- see 816a5f43eb02 for why."""
    if op.get_bind().dialect.name == "postgresql":
        return postgresql.ENUM(*values, name=name, create_type=False)
    return sa.Enum(*values, name=name)


def _views(columns: Sequence[str]) -> sa.TableClause:
    return sa.table("savedview", sa.column("id"), *(sa.column(c) for c in columns))


def upgrade() -> None:
    with op.batch_alter_table("savedview", schema=None) as batch_op:
        for _, new in _LISTS:
            batch_op.add_column(
                sa.Column(new, _JSON, nullable=False, server_default="[]")
            )
        for switch in _SWITCHES:
            batch_op.add_column(
                sa.Column(
                    switch, sa.Boolean(), nullable=False, server_default=sa.false()
                )
            )

    # Row by row in Python: a handful of views per team, and a JSON literal
    # that reads the same on SQLite and Postgres is worth more than speed.
    bind = op.get_bind()
    old = _views([o for o, _ in _LISTS])
    new = sa.table(
        "savedview", sa.column("id"), *(sa.column(n, _JSON) for _, n in _LISTS)
    )
    for row in bind.execute(sa.select(old)).mappings().all():
        values = {n: [] if row[o] is None else [row[o]] for o, n in _LISTS}
        if any(values.values()):
            bind.execute(new.update().where(new.c.id == row["id"]).values(**values))

    with op.batch_alter_table("savedview", schema=None) as batch_op:
        for name, _, _ in _FKS:
            batch_op.drop_constraint(name, type_="foreignkey")
        for o, _ in _LISTS:
            batch_op.drop_column(o)


def downgrade() -> None:
    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.add_column(sa.Column("status_id", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "priority",
                _existing_enum(
                    "ticketpriority", "no_priority", "urgent", "high", "medium", "low"
                ),
                nullable=True,
            )
        )
        batch_op.add_column(sa.Column("assignee_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("label_id", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "type",
                _existing_enum("tickettype", "bug", "task", "story"),
                nullable=True,
            )
        )

    bind = op.get_bind()
    lists = sa.table(
        "savedview", sa.column("id"), *(sa.column(n, _JSON) for _, n in _LISTS)
    )
    old = _views([o for o, _ in _LISTS])
    for row in bind.execute(sa.select(lists)).mappings().all():
        values = {o: (row[n] or [None])[0] for o, n in _LISTS}
        if any(value is not None for value in values.values()):
            bind.execute(old.update().where(old.c.id == row["id"]).values(**values))

    with op.batch_alter_table("savedview", schema=None) as batch_op:
        for name, column, target in _FKS:
            batch_op.create_foreign_key(name, target, [column], ["id"])
        for switch in _SWITCHES:
            batch_op.drop_column(switch)
        for _, n in _LISTS:
            batch_op.drop_column(n)
