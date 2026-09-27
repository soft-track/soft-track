"""rename cycles to sprints

Revision ID: 246debfdbf3b
Revises: c7e3a9d15b28
Create Date: 2026-09-27

Issue #214: a cycle is a sprint, in the database as everywhere else. The
`cycle` table becomes `sprint`, and every column, index, foreign key, enum
type and enum value that carried the old name follows.

Two kinds of stored string name them as well. A webhook's subscribed events
and a delivery's event hold `cycle.started` and `cycle.completed`, and the
code parses both back into an enum that no longer has those members, so they
are rewritten. An automation run's summary ("Moved to Cycle 3") is not: the
log is deliberately a record of what was written at the time.

Tables and columns are renamed in place on both databases. SQLite can only
rename a foreign key by rebuilding its table, which the batch operations do,
and rebuilding `issue` drops the search index's triggers, so they are put
back as 5b8e2d4c9a17 wrote them.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "246debfdbf3b"
down_revision: Union[str, Sequence[str], None] = "c7e3a9d15b28"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: (table, old column, new column)
_COLUMNS = [
    ("issue", "cycle_id", "sprint_id"),
    ("savedview", "cycle_id", "sprint_id"),
    ("automationrule", "set_cycle_id", "set_sprint_id"),
    ("automationrule", "move_to_active_cycle", "move_to_active_sprint"),
    ("team", "next_cycle_number", "next_sprint_number"),
]

#: (table, column, referenced table, old name, new name). Tables and columns
#: by their new names: constraints are renamed while those are in place, on
#: the way up and on the way down.
_FOREIGN_KEYS = [
    ("sprint", "team_id", "team", "fk_cycle_team_id_team", "fk_sprint_team_id_team"),
    (
        "issue",
        "sprint_id",
        "sprint",
        "fk_issue_cycle_id_cycle",
        "fk_issue_sprint_id_sprint",
    ),
    (
        "savedview",
        "sprint_id",
        "sprint",
        "fk_savedview_cycle_id_cycle",
        "fk_savedview_sprint_id_sprint",
    ),
    (
        "automationrule",
        "set_sprint_id",
        "sprint",
        "fk_automationrule_set_cycle_id_cycle",
        "fk_automationrule_set_sprint_id_sprint",
    ),
]

#: (table, column, old name, new name), by new table and column names too.
_INDEXES = [
    ("sprint", "state", "ix_cycle_state", "ix_sprint_state"),
    ("sprint", "team_id", "ix_cycle_team_id", "ix_sprint_team_id"),
    ("issue", "sprint_id", "ix_issue_cycle_id", "ix_issue_sprint_id"),
]

#: (Postgres enum type, the columns using it, old value, new value). On
#: SQLite an enum is a plain string column, so its rows are updated instead.
_ENUM_VALUES = [
    ("issueeventfield", [("issueevent", "field")], "cycle", "sprint"),
    (
        "automationtrigger",
        [("automationrule", "trigger"), ("automationrun", "trigger")],
        "cycle_completed",
        "sprint_completed",
    ),
]

#: Outbound webhook events, stored by value in plain strings.
_WEBHOOK_EVENTS = {
    "cycle.started": "sprint.started",
    "cycle.completed": "sprint.completed",
}

#: The issue triggers from 5b8e2d4c9a17, for putting back after a rebuild.
_ISSUE_SEARCH_TRIGGERS = [
    "DROP TRIGGER IF EXISTS issue_fts_insert",
    "DROP TRIGGER IF EXISTS issue_fts_delete",
    "DROP TRIGGER IF EXISTS issue_fts_update",
    """CREATE TRIGGER issue_fts_insert AFTER INSERT ON issue BEGIN
        INSERT INTO issue_fts(rowid, title, description)
        VALUES (new.id, new.title, new.description);
    END""",
    """CREATE TRIGGER issue_fts_delete AFTER DELETE ON issue BEGIN
        INSERT INTO issue_fts(issue_fts, rowid, title, description)
        VALUES ('delete', old.id, old.title, old.description);
    END""",
    """CREATE TRIGGER issue_fts_update AFTER UPDATE OF title, description ON issue
    BEGIN
        INSERT INTO issue_fts(issue_fts, rowid, title, description)
        VALUES ('delete', old.id, old.title, old.description);
        INSERT INTO issue_fts(rowid, title, description)
        VALUES (new.id, new.title, new.description);
    END""",
]


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _has_search_index() -> bool:
    """False on a SQLite without FTS5, where 5b8e2d4c9a17 created nothing."""
    return (
        op.get_bind()
        .exec_driver_sql("SELECT 1 FROM sqlite_master WHERE name = 'issue_fts'")
        .first()
        is not None
    )


def _rename_columns(renames: list[tuple[str, str, str]]) -> None:
    # In place on both: SQLite has had RENAME COLUMN since 3.25, and it
    # rewrites the indexes and foreign keys that name the column.
    for table, source, target in renames:
        op.execute(f"ALTER TABLE {table} RENAME COLUMN {source} TO {target}")


def _rename_constraints_and_indexes(forward: bool) -> None:
    """Rename them to the new names, or back. Runs while the table is called
    `sprint` and its columns have their new names, in both directions."""
    pick = (lambda old, new: (old, new)) if forward else (lambda old, new: (new, old))

    if _is_postgres():
        for table, _, _, old, new in _FOREIGN_KEYS:
            source, target = pick(old, new)
            op.execute(f"ALTER TABLE {table} RENAME CONSTRAINT {source} TO {target}")
        for _, _, old, new in _INDEXES:
            source, target = pick(old, new)
            op.execute(f"ALTER INDEX {source} RENAME TO {target}")
        # Named after the table by Postgres itself, not by any migration.
        source, target = pick("cycle", "sprint")
        op.execute(
            f"ALTER TABLE sprint RENAME CONSTRAINT {source}_pkey TO {target}_pkey"
        )
        op.execute(f"ALTER SEQUENCE {source}_id_seq RENAME TO {target}_id_seq")
        op.execute(f"ALTER TYPE {source}state RENAME TO {target}state")
        return

    for table in ("sprint", "issue", "savedview", "automationrule"):
        with op.batch_alter_table(table, recreate="always") as batch_op:
            for fk_table, column, referent, old, new in _FOREIGN_KEYS:
                if fk_table == table:
                    source, target = pick(old, new)
                    batch_op.drop_constraint(source, type_="foreignkey")
                    batch_op.create_foreign_key(target, referent, [column], ["id"])
            for ix_table, column, old, new in _INDEXES:
                if ix_table == table:
                    source, target = pick(old, new)
                    batch_op.drop_index(source)
                    batch_op.create_index(target, [column])
    # Rebuilding `issue` dropped the search index's triggers with the old
    # table. tests/test_search_fts.py fails if any migration loses them.
    if _has_search_index():
        for statement in _ISSUE_SEARCH_TRIGGERS:
            op.execute(statement)


def _rename_enum_values(forward: bool) -> None:
    for type_name, columns, old, new in _ENUM_VALUES:
        source, target = (old, new) if forward else (new, old)
        if _is_postgres():
            op.execute(f"ALTER TYPE {type_name} RENAME VALUE '{source}' TO '{target}'")
            continue
        for table, column in columns:
            rows = sa.table(table, sa.column(column))
            op.execute(
                rows.update().where(rows.c[column] == source).values({column: target})
            )


def _rename_webhook_events(renames: dict[str, str]) -> None:
    bind = op.get_bind()
    hooks = sa.table("outboundwebhook", sa.column("id"), sa.column("events"))
    for hook_id, stored in bind.execute(sa.select(hooks.c.id, hooks.c.events)).all():
        # Sorted and de-duplicated, the way outbound.store_events writes them.
        rewritten = ",".join(
            sorted({renames.get(value, value) for value in stored.split(",") if value})
        )
        if rewritten != stored:
            bind.execute(
                hooks.update().where(hooks.c.id == hook_id).values(events=rewritten)
            )

    deliveries = sa.table("webhookdelivery", sa.column("event"))
    for source, target in renames.items():
        bind.execute(
            deliveries.update().where(deliveries.c.event == source).values(event=target)
        )


def upgrade() -> None:
    op.rename_table("cycle", "sprint")
    _rename_columns(_COLUMNS)
    _rename_constraints_and_indexes(forward=True)
    _rename_enum_values(forward=True)
    _rename_webhook_events(_WEBHOOK_EVENTS)


def downgrade() -> None:
    _rename_webhook_events({new: old for old, new in _WEBHOOK_EVENTS.items()})
    _rename_enum_values(forward=False)
    _rename_constraints_and_indexes(forward=False)
    _rename_columns([(table, new, old) for table, old, new in _COLUMNS])
    op.rename_table("sprint", "cycle")
