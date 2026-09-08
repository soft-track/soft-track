"""Alembic environment for SoftTrack.

The URL comes from the application's own Settings, so migrations always target
the database the app is configured for -- nothing is duplicated in alembic.ini.

Unlike a raw-SQL project, SoftTrack has SQLModel tables, so `target_metadata`
is real and `alembic revision --autogenerate` genuinely works. Still read what
it generates: autogenerate is good at columns and tables, and unreliable about
server defaults, constraint renames, and anything involving data.
"""

from logging.config import fileConfig

from sqlalchemy import engine_from_config, event, pool
from sqlmodel import SQLModel

from alembic import context

# Importing the tables registers them on SQLModel.metadata.
from lib_softtrack import tables  # noqa: F401
from web import settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Only when the caller has not already chosen one. alembic.ini carries no
# URL, so the application path is unchanged -- but a test (or an operator
# running a migration against a copy) can set it on the Config and have that
# respected instead of silently retargeted at the configured database.
if not config.get_main_option("sqlalchemy.url", None):
    config.set_main_option("sqlalchemy.url", settings.database_url)

target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of running it (`alembic upgrade head --sql`)."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    if connectable.dialect.name == "sqlite":

        @event.listens_for(connectable, "connect")
        def _foreign_keys_off_for_migrations(dbapi_connection, _record):
            """Batch mode rewrites a table by copying it, dropping the original
            and renaming -- and dropping a table other rows point at is a
            foreign key violation while enforcement is on. Any SQLite install
            with issues in it would fail every migration that touches the
            `issue` table, which is most of them.

            On the connect event rather than as a statement, because SQLite
            ignores `PRAGMA foreign_keys` inside a transaction and SQLAlchemy
            has already opened one by the time a normal execute runs.

            Scoped to this engine, so it is off for the migration and nothing
            else: the application and the test suite both turn enforcement on
            for their own connections, deliberately. Postgres needs none of
            this and gets none of it.
            """
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=OFF")
            cursor.close()

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # SQLite cannot ALTER most things in place; batch mode rewrites the
            # table instead. Harmless on Postgres, essential on the SQLite default.
            render_as_batch=connection.dialect.name == "sqlite",
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
