"""Copy an install's data from SQLite into Postgres (#361).

Run with:

    python move_to_postgres.py --from sqlite:////data/softtrack.db \\
        --to postgresql+psycopg://softtrack:softtrack@db:5432/softtrack

`--to` defaults to `DATABASE_URL`, so inside the docker compose backend only
`--from` is needed. docs/deployment.md has the whole move, of which this is
the data step.

The schema is not this script's job: Alembic makes it, the same way for both
databases, by starting the app against the new `DATABASE_URL`. This only
copies rows, and refuses unless both databases are at the same revision.

Rows are read through the app's own tables rather than as raw SQLite values,
so booleans, datetimes, enums and JSON arrive in Postgres as what they are and
not as the integers and strings SQLite keeps them as.
"""

import argparse
import os
import sys
from graphlib import CycleError, TopologicalSorter

from sqlalchemy import (
    Engine,
    Integer,
    Table,
    bindparam,
    create_engine,
    func,
    inspect,
    select,
    text,
)
from sqlmodel import SQLModel

import lib_softtrack.tables  # noqa: F401 -- registers every table on the metadata

BATCH = 1000


def copy_order(metadata) -> tuple[list[Table], dict[str, list[str]]]:
    """The tables in an order their rows can be inserted in, and the columns
    that have to wait.

    A row can only point at a row that is already there. Most tables sort into
    that order, but a few point at each other -- a team and its sprints and
    saved views, a ticket at its parent, a person at their manager -- and some
    of the links are only known once both rows exist. Where a cycle has to be
    broken it is broken at a column that may be empty: that column is copied
    as empty and filled in once every row is in.
    """
    tables = {name: metadata.tables[name] for name in sorted(metadata.tables)}
    needs = {name: set() for name in tables}
    for table in tables.values():
        for fk in table.foreign_keys:
            if fk.column.table.name != table.name:
                needs[table.name].add(fk.column.table.name)

    while True:
        try:
            order = list(TopologicalSorter(needs).static_order())
            break
        except CycleError as error:
            # Each node in the cycle is needed by the next one.
            cycle = error.args[1]
            for needed, table in zip(cycle, cycle[1:]):
                links = [
                    fk.parent
                    for fk in tables[table].foreign_keys
                    if fk.column.table.name == needed
                ]
                if all(column.nullable for column in links):
                    needs[table].discard(needed)
                    break
            else:
                raise SystemExit(
                    f"Cannot order the tables: {' -> '.join(cycle)} only links "
                    "through columns that may not be empty."
                )

    position = {name: index for index, name in enumerate(order)}
    later: dict[str, list[str]] = {}
    for name in order:
        for fk in tables[name].foreign_keys:
            if position[fk.column.table.name] >= position[name]:
                later.setdefault(name, []).append(fk.parent.name)
    return [tables[name] for name in order], later


def revision(engine: Engine) -> str | None:
    if "alembic_version" not in inspect(engine).get_table_names():
        return None
    with engine.connect() as connection:
        return connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar()


def same_revision(source: Engine, target: Engine) -> str:
    """The Alembic revision both databases are at, or the reason to stop."""
    at, want = revision(source), revision(target)
    if at is None or at != want:
        raise SystemExit(
            f"The databases are at different revisions (SQLite: {at}, Postgres: "
            f"{want}). Start this version of SoftTrack once against each, so "
            "Alembic brings both to the same one, then run this again."
        )
    return at


def count(connection, table: Table) -> int:
    return connection.execute(select(func.count()).select_from(table)).scalar_one()


def move(
    source: Engine, target: Engine, *, replace: bool = False, out=print
) -> dict[str, int]:
    """Copy every row from `source` to `target`; return the rows per table.

    `target` has to be empty, apart from what `seed.py` puts in a fresh
    database on its first start -- which `replace` deletes first.
    """
    tables, later = copy_order(SQLModel.metadata)
    by_name = {table.name: table for table in tables}

    have = set(inspect(source).get_table_names())
    missing = [table.name for table in tables if table.name not in have]
    if missing:
        raise SystemExit(f"The SQLite database has no {', '.join(missing)} table.")

    with target.begin() as connection:
        filled = [table.name for table in tables if count(connection, table)]
        if filled and not replace:
            raise SystemExit(
                "The Postgres database already has rows (in "
                f"{', '.join(filled)}) -- usually the demo data seed.py adds on "
                "first start. Run again with --replace to delete them first."
            )
        if filled:
            out("Deleting what is already in the Postgres database")
            # The links that point forward go first, so nothing is left
            # pointing at a row about to go.
            for name, columns in later.items():
                connection.execute(
                    by_name[name].update().values({c: None for c in columns})
                )
            for table in reversed(tables):
                connection.execute(table.delete())

        with source.connect() as reading:
            for table in tables:
                waiting = later.get(table.name, [])
                rows = reading.execute(
                    select(table).order_by(*table.primary_key.columns)
                )
                while batch := rows.mappings().fetchmany(BATCH):
                    connection.execute(
                        table.insert(),
                        [
                            {**row, **{column: None for column in waiting}}
                            for row in batch
                        ],
                    )

            # The links that could not be made on the way in.
            for name, columns in later.items():
                table = by_name[name]
                keys = [column.name for column in table.primary_key.columns]
                statement = (
                    table.update()
                    .where(*(table.c[key] == bindparam(f"_{key}") for key in keys))
                    .values({column: bindparam(f"_{column}") for column in columns})
                )
                rows = reading.execute(
                    select(
                        *(table.c[key] for key in keys), *(table.c[c] for c in columns)
                    )
                )
                while batch := rows.mappings().fetchmany(BATCH):
                    params = [
                        {f"_{key}": value for key, value in row.items()}
                        for row in batch
                        if any(row[column] is not None for column in columns)
                    ]
                    if params:
                        connection.execute(statement, params)

        if target.dialect.name == "postgresql":
            # The rows came with their ids, so each id sequence is still at 1
            # and the next ticket would collide with the first.
            for table in tables:
                if "id" in table.c and isinstance(table.c.id.type, Integer):
                    connection.execute(
                        text(
                            f"SELECT setval(pg_get_serial_sequence('\"{table.name}\"', 'id'), "
                            f'coalesce(max(id), 1), max(id) IS NOT NULL) FROM "{table.name}"'
                        )
                    )

    with source.connect() as before, target.connect() as after:
        copied = {table.name: count(after, table) for table in tables}
        for table in tables:
            if count(before, table) != copied[table.name]:
                raise SystemExit(f"{table.name}: the row counts differ after the copy.")
    return copied


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--from", dest="source", required=True, help="the SQLite URL")
    parser.add_argument(
        "--to",
        dest="target",
        default=os.environ.get("DATABASE_URL"),
        help="the Postgres URL (default: DATABASE_URL)",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="delete what the Postgres database already holds, such as the demo data",
    )
    args = parser.parse_args(argv)

    if not args.source.startswith("sqlite"):
        parser.error("--from has to be a sqlite:/// URL")
    if not args.target or not args.target.startswith("postgresql"):
        parser.error("--to (or DATABASE_URL) has to be a postgresql+psycopg:// URL")

    source = create_engine(args.source)
    target = create_engine(args.target)

    at = same_revision(source, target)
    copied = move(source, target, replace=args.replace)
    filled = {name: rows for name, rows in copied.items() if rows}
    width = max((len(name) for name in filled), default=0)
    for name, rows in filled.items():
        print(f"{name:<{width}}  {rows}")
    print(
        f"Copied {sum(copied.values())} rows in {len(copied)} tables at revision {at}."
    )


if __name__ == "__main__":
    main(sys.argv[1:])
