"""releases

Revision ID: d2f7a4c1b893
Revises: c2a1b3d45e67
Create Date: 2026-10-14

Issue #272: the versions a team ships. A `release` table -- a name per team,
a description, a target date, a state and the day it shipped -- and a fix
version on a ticket, one release per ticket. A saved view can filter on it,
the board can group by it, and an automation rule can set it.

Every existing ticket is in no release and every existing view asks nothing
about one, so nothing anybody has changes. History gets a `fix_version`
field and grouping a `release` value, added outside the transaction on
Postgres and not at all on SQLite, the way a9c3e5d71f42 added its fields.

The downgrade drops the table, the columns and that history. The labels stay
on the Postgres enum types, which have no DROP VALUE.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401 -- autogenerate emits sqlmodel.sql.sqltypes.AutoString()
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "d2f7a4c1b893"
down_revision: Union[str, Sequence[str], None] = "c2a1b3d45e67"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = sa.JSON().with_variant(JSONB(), "postgresql")
_STATE = sa.Enum("planned", "released", "archived", name="releasestate")

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
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute(
                "ALTER TYPE ticketeventfield ADD VALUE IF NOT EXISTS 'fix_version'"
            )
            op.execute("ALTER TYPE ticketgrouping ADD VALUE IF NOT EXISTS 'release'")

    op.create_table(
        "release",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("state", _STATE, nullable=False),
        sa.Column("released_on", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["team_id"], ["team.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("team_id", "name", name="uq_release_team_name"),
    )
    with op.batch_alter_table("release", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_release_team_id"), ["team_id"])
        batch_op.create_index(batch_op.f("ix_release_state"), ["state"])

    with op.batch_alter_table("ticket", schema=None) as batch_op:
        batch_op.add_column(sa.Column("fix_version_id", sa.Integer(), nullable=True))
        batch_op.create_index(
            batch_op.f("ix_ticket_fix_version_id"), ["fix_version_id"]
        )
        batch_op.create_foreign_key(
            "fk_ticket_fix_version_id_release", "release", ["fix_version_id"], ["id"]
        )
    _restore_search_triggers()

    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("fix_version_ids", _JSON, nullable=False, server_default="[]")
        )
        batch_op.add_column(
            sa.Column(
                "fix_version_exclude",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )

    with op.batch_alter_table("automationrule", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("set_fix_version_id", sa.Integer(), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_automationrule_set_fix_version_id_release",
            "release",
            ["set_fix_version_id"],
            ["id"],
        )


def downgrade() -> None:
    op.execute("DELETE FROM ticketevent WHERE field = 'fix_version'")
    # A view grouped by release opens by status, as every view did before.
    op.execute("UPDATE savedview SET group_by = 'status' WHERE group_by = 'release'")

    with op.batch_alter_table("automationrule", schema=None) as batch_op:
        batch_op.drop_constraint(
            "fk_automationrule_set_fix_version_id_release", type_="foreignkey"
        )
        batch_op.drop_column("set_fix_version_id")
    with op.batch_alter_table("savedview", schema=None) as batch_op:
        batch_op.drop_column("fix_version_exclude")
        batch_op.drop_column("fix_version_ids")
    with op.batch_alter_table("ticket", schema=None) as batch_op:
        batch_op.drop_constraint("fk_ticket_fix_version_id_release", type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_ticket_fix_version_id"))
        batch_op.drop_column("fix_version_id")
    _restore_search_triggers()

    with op.batch_alter_table("release", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_release_state"))
        batch_op.drop_index(batch_op.f("ix_release_team_id"))
    op.drop_table("release")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        postgresql.ENUM(name="releasestate").drop(bind, checkfirst=True)
