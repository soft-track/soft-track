"""The employee profile migration (#122), against a database with accounts in it.

Three nullable columns on `user`, so the risk is small and specific: that
every existing account comes out with nothing filled in, and that the
downgrade -- which rebuilds `user` on SQLite -- keeps the accounts, their
unique handles and addresses, and nothing else of this revision.
"""

import sqlite3
from datetime import date

import pytest
from alembic import command

from tests.test_reactions_migration import _config

BEFORE = "06abb8eb700e"
AFTER = "24d062e0431b"


def _read(db_path, sql):
    connection = sqlite3.connect(db_path)
    try:
        return connection.execute(sql).fetchall()
    finally:
        connection.close()


def _columns(db_path):
    return {row[1] for row in _read(db_path, "PRAGMA table_info(user)")}


def _insert_user(db_path, user_id, email, username):
    connection = sqlite3.connect(db_path)
    try:
        connection.execute(
            "INSERT INTO user (id, email, username, hashed_password, full_name,"
            " avatar_color, is_active, is_site_admin, token_version,"
            " email_notifications, created_at) VALUES (?, ?, ?, 'x', 'A',"
            " '#6366f1', 1, 0, 0, 1, '2026-01-01 00:00:00')",
            (user_id, email, username),
        )
        connection.commit()
    finally:
        # Closed even when the insert is refused, or its open transaction
        # would lock the file against the next one.
        connection.close()


def test_existing_accounts_have_nothing_filled_in_and_it_comes_off_cleanly(
    tmp_path,
):
    db_path = tmp_path / "profiles.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    _insert_user(db_path, 1, "ada@b.c", "ada")
    _insert_user(db_path, 2, "sam@b.c", "sam")

    command.upgrade(config, AFTER)
    assert _read(
        db_path, "SELECT username, job_title, location, started_on FROM user"
    ) == [("ada", None, None, None), ("sam", None, None, None)]

    command.downgrade(config, BEFORE)
    assert not {"job_title", "location", "started_on"} & _columns(db_path)
    assert _read(db_path, "SELECT id, email, username FROM user ORDER BY id") == [
        (1, "ada@b.c", "ada"),
        (2, "sam@b.c", "sam"),
    ]
    # The rebuild kept the unique handle and address.
    with pytest.raises(sqlite3.IntegrityError):
        _insert_user(db_path, 3, "other@b.c", "ada")
    with pytest.raises(sqlite3.IntegrityError):
        _insert_user(db_path, 3, "ada@b.c", "other")

    command.upgrade(config, AFTER)
    assert {"job_title", "location", "started_on"} <= _columns(db_path)


def test_the_columns_are_the_ones_the_model_writes(tmp_path):
    from sqlmodel import Session, create_engine

    from lib_softtrack.tables import User

    db_path = tmp_path / "model.db"
    config = _config(db_path)
    command.upgrade(config, BEFORE)
    _insert_user(db_path, 1, "ada@b.c", "ada")
    # The rest of the way before reading through the model, which has every
    # column today's `User` has -- including any added after this revision.
    command.upgrade(config, "head")

    engine = create_engine(f"sqlite:///{db_path}")
    with Session(engine) as session:
        user = session.get(User, 1)
        user.job_title = "Analyst"
        user.location = "London"
        user.started_on = date(2023, 8, 14)
        session.add(user)
        session.commit()
    engine.dispose()

    assert _read(db_path, "SELECT job_title, location, started_on FROM user") == [
        ("Analyst", "London", "2023-08-14")
    ]
