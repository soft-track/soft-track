"""rename issues to tickets

Revision ID: 06abb8eb700e
Revises: 246debfdbf3b
Create Date: 2026-09-27

Issue #215: an issue is a ticket in the database, as in every other layer.
Six tables and ten columns carry the name, and so do dozens of indexes,
constraints, sequences and enum types -- several of them named by Postgres
itself (`comment_issue_id_fkey`), not by any migration. Those are found in
the catalog rather than listed here, and every name that says `issue` says
`ticket` afterwards. That is safe because nothing said `ticket` before, so
the way down can do the same in reverse.

Stored strings are rewritten as in 246debfdbf3b: the automation triggers
`issue_created` and `issue_assigned`, which are enum values on Postgres and
plain strings on SQLite, and the webhook events `issue.*` that a
subscription or a delivery holds.

On SQLite the search index is an FTS5 table whose definition names its
content table, so it cannot follow a rename. It is dropped first and built
again against `ticket` at the end, from the same DDL as
lib_softtrack/search_fts.py. Constraint names change by rebuilding the
tables that carry them, since SQLite offers no other way.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "06abb8eb700e"
down_revision: Union[str, Sequence[str], None] = "246debfdbf3b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: (old table, new table)
_TABLES = [
    ("issue", "ticket"),
    ("issueevent", "ticketevent"),
    ("issuelabellink", "ticketlabellink"),
    ("issuelink", "ticketlink"),
    ("issuetemplate", "tickettemplate"),
    ("issuewatch", "ticketwatch"),
]

#: (table, by its new name; old column, new column)
_COLUMNS = [
    ("attachment", "issue_id", "ticket_id"),
    ("automationrun", "issue_id", "ticket_id"),
    ("codelink", "issue_id", "ticket_id"),
    ("comment", "issue_id", "ticket_id"),
    ("notification", "issue_id", "ticket_id"),
    ("ticketevent", "issue_id", "ticket_id"),
    ("ticketlabellink", "issue_id", "ticket_id"),
    ("ticketwatch", "issue_id", "ticket_id"),
    ("worklog", "issue_id", "ticket_id"),
    ("team", "next_issue_number", "next_ticket_number"),
]

#: Automation triggers: enum values on Postgres, strings on SQLite.
_TRIGGERS = {
    "issue_created": "ticket_created",
    "issue_assigned": "ticket_assigned",
}

#: Outbound webhook events, stored by value in plain strings.
_WEBHOOK_EVENTS = {
    "issue.created": "ticket.created",
    "issue.updated": "ticket.updated",
    "issue.status_changed": "ticket.status_changed",
}

#: As in lib_softtrack/search_fts.py.
_TOKENIZER = "porter unicode61"


def _search_index(table: str) -> list[str]:
    """The FTS5 table over `table` and the triggers that keep it in step,
    written exactly as 5b8e2d4c9a17 and lib_softtrack/search_fts.py write
    them. tests/test_search_fts.py compares the two."""
    return [
        f"""CREATE VIRTUAL TABLE {table}_fts USING fts5(
        title, description, content='{table}', content_rowid='id',
        tokenize='{_TOKENIZER}')""",
        f"""CREATE TRIGGER {table}_fts_insert AFTER INSERT ON {table} BEGIN
        INSERT INTO {table}_fts(rowid, title, description)
        VALUES (new.id, new.title, new.description);
    END""",
        f"""CREATE TRIGGER {table}_fts_delete AFTER DELETE ON {table} BEGIN
        INSERT INTO {table}_fts({table}_fts, rowid, title, description)
        VALUES ('delete', old.id, old.title, old.description);
    END""",
        f"""CREATE TRIGGER {table}_fts_update AFTER UPDATE OF title, description ON {table}
    BEGIN
        INSERT INTO {table}_fts({table}_fts, rowid, title, description)
        VALUES ('delete', old.id, old.title, old.description);
        INSERT INTO {table}_fts(rowid, title, description)
        VALUES (new.id, new.title, new.description);
    END""",
    ]


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _drop_search_index(table: str) -> bool:
    """Drop the FTS5 index over `table`, saying whether there was one. A
    SQLite without FTS5 never had one (5b8e2d4c9a17), and gets none back."""
    bind = op.get_bind()
    exists = (
        bind.exec_driver_sql(
            "SELECT 1 FROM sqlite_master WHERE name = ?", (f"{table}_fts",)
        ).first()
        is not None
    )
    if exists:
        for trigger in ("insert", "delete", "update"):
            op.execute(f"DROP TRIGGER IF EXISTS {table}_fts_{trigger}")
        op.execute(f"DROP TABLE {table}_fts")
    return exists


def _build_search_index(table: str) -> None:
    for statement in _search_index(table):
        op.execute(statement)
    op.execute(f"INSERT INTO {table}_fts({table}_fts) VALUES ('rebuild')")


def _rename_tables_and_columns(forward: bool) -> None:
    if forward:
        for old, new in _TABLES:
            op.rename_table(old, new)
        for table, old, new in _COLUMNS:
            op.execute(f"ALTER TABLE {table} RENAME COLUMN {old} TO {new}")
    else:
        # Columns first, while their tables still have the names listed.
        for table, old, new in _COLUMNS:
            op.execute(f"ALTER TABLE {table} RENAME COLUMN {new} TO {old}")
        for old, new in _TABLES:
            op.rename_table(new, old)


def _rename_postgres_names(source: str, target: str) -> None:
    """Every constraint, index, sequence and enum type whose name says
    `source`, renamed to say `target`."""
    bind = op.get_bind()

    def named(sql: str) -> list:
        return bind.execute(sa.text(sql), {"pattern": f"%{source}%"}).all()

    # Constraints first: renaming a primary key or unique constraint renames
    # the index behind it too.
    for table, name in named(
        "SELECT conrelid::regclass::text, conname FROM pg_constraint"
        " WHERE conname LIKE :pattern AND conrelid <> 0"
    ):
        op.execute(
            f'ALTER TABLE {table} RENAME CONSTRAINT "{name}"'
            f' TO "{name.replace(source, target)}"'
        )
    for kind, statement in (("i", "INDEX"), ("S", "SEQUENCE")):
        for (name,) in named(
            f"SELECT relname FROM pg_class WHERE relkind = '{kind}'"
            " AND relname LIKE :pattern AND pg_table_is_visible(oid)"
        ):
            op.execute(
                f'ALTER {statement} "{name}" RENAME TO "{name.replace(source, target)}"'
            )
    for (name,) in named(
        "SELECT typname FROM pg_type WHERE typtype = 'e' AND typname LIKE :pattern"
    ):
        op.execute(f'ALTER TYPE "{name}" RENAME TO "{name.replace(source, target)}"')


def _rename_sqlite_names(source: str, target: str) -> None:
    """The same on SQLite: indexes are recreated under the new name, and a
    table whose constraints are named after `source` is rebuilt."""
    bind = op.get_bind()
    for name, sql in bind.exec_driver_sql(
        "SELECT name, sql FROM sqlite_master"
        " WHERE type = 'index' AND sql IS NOT NULL AND name LIKE ?",
        (f"%{source}%",),
    ).all():
        # SQLite has already rewritten the table and columns the index is
        # on; only its own name is left to change.
        op.execute(f'DROP INDEX "{name}"')
        op.execute(sql.replace(name, name.replace(source, target), 1))

    inspector = sa.inspect(bind)
    for table in inspector.get_table_names():
        foreign_keys = [
            key
            for key in inspector.get_foreign_keys(table)
            if source in (key.get("name") or "")
        ]
        uniques = [
            unique
            for unique in inspector.get_unique_constraints(table)
            if source in (unique.get("name") or "")
        ]
        if not foreign_keys and not uniques:
            continue
        with op.batch_alter_table(table, recreate="always") as batch_op:
            for key in foreign_keys:
                batch_op.drop_constraint(key["name"], type_="foreignkey")
                batch_op.create_foreign_key(
                    key["name"].replace(source, target),
                    key["referred_table"],
                    key["constrained_columns"],
                    key["referred_columns"],
                    **key.get("options", {}),
                )
            for unique in uniques:
                batch_op.drop_constraint(unique["name"], type_="unique")
                batch_op.create_unique_constraint(
                    unique["name"].replace(source, target), unique["column_names"]
                )


def _rename_triggers(renames: dict[str, str]) -> None:
    if _is_postgres():
        for source, target in renames.items():
            op.execute(
                f"ALTER TYPE automationtrigger RENAME VALUE '{source}' TO '{target}'"
            )
        return
    for table in ("automationrule", "automationrun"):
        rows = sa.table(table, sa.column("trigger"))
        for source, target in renames.items():
            op.execute(
                rows.update().where(rows.c.trigger == source).values(trigger=target)
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
    postgres = _is_postgres()
    had_search_index = not postgres and _drop_search_index("issue")

    _rename_tables_and_columns(forward=True)
    if postgres:
        _rename_postgres_names("issue", "ticket")
    else:
        _rename_sqlite_names("issue", "ticket")
    _rename_triggers(_TRIGGERS)
    _rename_webhook_events(_WEBHOOK_EVENTS)

    if had_search_index:
        _build_search_index("ticket")


def downgrade() -> None:
    postgres = _is_postgres()
    had_search_index = not postgres and _drop_search_index("ticket")

    _rename_webhook_events({new: old for old, new in _WEBHOOK_EVENTS.items()})
    _rename_triggers({new: old for old, new in _TRIGGERS.items()})
    if postgres:
        _rename_postgres_names("ticket", "issue")
    else:
        _rename_sqlite_names("ticket", "issue")
    _rename_tables_and_columns(forward=False)

    if had_search_index:
        _build_search_index("issue")
