"""add the trash

Revision ID: 45e4506be3db
Revises: 266072764727
Create Date: 2026-10-01

Issue #323: deleting a ticket or an epic moves it to the trash instead of
removing it. `ticket` and `project` gain `deleted_at` and
`deleted_by_id`; a row with `deleted_at` set keeps everything that points
at it, and the app leaves it out of its queries until it is restored or
purged.

`team.any_member_may_delete` says who may delete. Existing teams get
True, which is what deleting was until now; the model's default, False,
leaves a new team's tickets to their creator and its admins.

History gets a `trash` field for moving into and out of it, added outside
the transaction on Postgres and not at all on SQLite, the way cf3f72037267
added `custom_field`.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "45e4506be3db"
down_revision: Union[str, Sequence[str], None] = "266072764727"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Named rather than left to autogenerate's `None`, which batch mode on SQLite
# refuses when it rebuilds a table.
_FKS = {
    "ticket": "fk_ticket_deleted_by_id_user",
    "project": "fk_project_deleted_by_id_user",
}

#: The search index's triggers on `ticket`, as 06abb8eb700e left them. A
#: foreign key cannot be added to a SQLite table in place, so batch mode
#: rebuilds `ticket`, and the rebuild drops its triggers with the old table.
#: tests/test_search_fts.py fails if any migration loses them.
_TICKET_SEARCH_TRIGGERS = [
    "DROP TRIGGER IF EXISTS ticket_fts_insert",
    "DROP TRIGGER IF EXISTS ticket_fts_delete",
    "DROP TRIGGER IF EXISTS ticket_fts_update",
    """CREATE TRIGGER ticket_fts_insert AFTER INSERT ON ticket BEGIN
        INSERT INTO ticket_fts(rowid, title, description)
        VALUES (new.id, new.title, new.description);
    END""",
    """CREATE TRIGGER ticket_fts_delete AFTER DELETE ON ticket BEGIN
        INSERT INTO ticket_fts(ticket_fts, rowid, title, description)
        VALUES ('delete', old.id, old.title, old.description);
    END""",
    """CREATE TRIGGER ticket_fts_update AFTER UPDATE OF title, description ON ticket
    BEGIN
        INSERT INTO ticket_fts(ticket_fts, rowid, title, description)
        VALUES ('delete', old.id, old.title, old.description);
        INSERT INTO ticket_fts(rowid, title, description)
        VALUES (new.id, new.title, new.description);
    END""",
]


def _restore_search_triggers() -> None:
    """Put the triggers back on a SQLite that has the index. A SQLite built
    without FTS5 never had one, and Postgres searches a different way."""
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        return
    has_index = bind.exec_driver_sql(
        "SELECT 1 FROM sqlite_master WHERE name = 'ticket_fts'"
    ).first()
    if has_index is not None:
        for statement in _TICKET_SEARCH_TRIGGERS:
            op.execute(statement)


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE ticketeventfield ADD VALUE IF NOT EXISTS 'trash'")

    for table, fk in _FKS.items():
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(sa.Column("deleted_at", sa.DateTime(), nullable=True))
            batch_op.add_column(sa.Column("deleted_by_id", sa.Integer(), nullable=True))
            batch_op.create_index(
                batch_op.f(f"ix_{table}_deleted_at"), ["deleted_at"], unique=False
            )
            batch_op.create_foreign_key(fk, "user", ["deleted_by_id"], ["id"])
    _restore_search_triggers()

    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "any_member_may_delete",
                sa.Boolean(),
                nullable=False,
                # Every team there is keeps deleting the way it always has.
                server_default=sa.true(),
            )
        )


def downgrade() -> None:
    """Take the trash away, and everything in it back out.

    The code this goes back to cannot tell a trashed row from a live one, so
    what is in the trash is restored rather than lost, and its `trash`
    history goes, which that code cannot read. The label stays on the
    Postgres type, which has no DROP VALUE.
    """
    op.execute("DELETE FROM ticketevent WHERE field = 'trash'")

    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.drop_column("any_member_may_delete")

    for table, fk in _FKS.items():
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_constraint(fk, type_="foreignkey")
            batch_op.drop_index(batch_op.f(f"ix_{table}_deleted_at"))
            batch_op.drop_column("deleted_by_id")
            batch_op.drop_column("deleted_at")
    _restore_search_triggers()
