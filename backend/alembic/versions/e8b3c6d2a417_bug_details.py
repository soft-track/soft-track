"""bug details

Revision ID: e8b3c6d2a417
Revises: d2f7a4c1b893
Create Date: 2026-10-14

Issue #273: what a bug has that a task does not. A severity, separate from
priority; an environment, one of the team's -- production, staging and
development until a team admin says otherwise; and the release it was found
in. A saved view can filter on each, and the board can group and the list
sort by them.

Every existing ticket has none of them, every team starts with the three
environments, and every existing view asks nothing about them. History gets
`severity`, `environment` and `found_in` fields, grouping `severity` and
`environment` values and sorting a `severity` value, added outside the
transaction on Postgres and not at all on SQLite, as d2f7a4c1b893 added its.

The downgrade drops the columns and that history; a view grouped or sorted
by one of these goes back to the default. The labels stay on the Postgres
enum types, which have no DROP VALUE.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401 -- autogenerate emits sqlmodel.sql.sqltypes.AutoString()
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "e8b3c6d2a417"
down_revision: Union[str, Sequence[str], None] = "d2f7a4c1b893"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON = sa.JSON().with_variant(JSONB(), "postgresql")
_SEVERITY = sa.Enum("critical", "major", "minor", "trivial", name="ticketseverity")
_LISTS = ("severities", "environments", "found_in_ids")
_SWITCHES = ("severity_exclude", "environment_exclude", "found_in_exclude")

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
            for value in ("severity", "environment", "found_in"):
                op.execute(
                    f"ALTER TYPE ticketeventfield ADD VALUE IF NOT EXISTS '{value}'"
                )
            for value in ("severity", "environment"):
                op.execute(
                    f"ALTER TYPE ticketgrouping ADD VALUE IF NOT EXISTS '{value}'"
                )
            op.execute("ALTER TYPE ticketsort ADD VALUE IF NOT EXISTS 'severity'")
    # add_column does not emit CREATE TYPE the way create_table does.
    _SEVERITY.create(bind, checkfirst=True)

    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "environments",
                _JSON,
                nullable=False,
                server_default='["Production", "Staging", "Development"]',
            )
        )

    with op.batch_alter_table("ticket", schema=None) as batch_op:
        batch_op.add_column(sa.Column("severity", _SEVERITY, nullable=True))
        batch_op.add_column(
            sa.Column("environment", sqlmodel.sql.sqltypes.AutoString(), nullable=True)
        )
        batch_op.add_column(sa.Column("found_in_id", sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f("ix_ticket_severity"), ["severity"])
        batch_op.create_index(batch_op.f("ix_ticket_environment"), ["environment"])
        batch_op.create_index(batch_op.f("ix_ticket_found_in_id"), ["found_in_id"])
        batch_op.create_foreign_key(
            "fk_ticket_found_in_id_release", "release", ["found_in_id"], ["id"]
        )
    _restore_search_triggers()

    with op.batch_alter_table("savedview", schema=None) as batch_op:
        for name in _LISTS:
            batch_op.add_column(
                sa.Column(name, _JSON, nullable=False, server_default="[]")
            )
        for switch in _SWITCHES:
            batch_op.add_column(
                sa.Column(
                    switch, sa.Boolean(), nullable=False, server_default=sa.false()
                )
            )


def downgrade() -> None:
    op.execute(
        "DELETE FROM ticketevent WHERE field IN ('severity', 'environment', 'found_in')"
    )
    op.execute(
        "UPDATE savedview SET group_by = 'status' "
        "WHERE group_by IN ('severity', 'environment')"
    )
    op.execute(
        "UPDATE savedview SET sort = NULL, sort_direction = NULL "
        "WHERE sort = 'severity'"
    )

    with op.batch_alter_table("savedview", schema=None) as batch_op:
        for name in (*_SWITCHES, *_LISTS):
            batch_op.drop_column(name)

    with op.batch_alter_table("ticket", schema=None) as batch_op:
        batch_op.drop_constraint("fk_ticket_found_in_id_release", type_="foreignkey")
        batch_op.drop_index(batch_op.f("ix_ticket_found_in_id"))
        batch_op.drop_index(batch_op.f("ix_ticket_environment"))
        batch_op.drop_index(batch_op.f("ix_ticket_severity"))
        batch_op.drop_column("found_in_id")
        batch_op.drop_column("environment")
        batch_op.drop_column("severity")
    _restore_search_triggers()

    with op.batch_alter_table("team", schema=None) as batch_op:
        batch_op.drop_column("environments")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        postgresql.ENUM(name="ticketseverity").drop(bind, checkfirst=True)
