"""Test fixtures.

Three decisions worth knowing about:

1. Each test gets a fresh in-memory SQLite database on a StaticPool, so the
   whole test runs against one connection and nothing leaks between tests.

2. SQLite does not enforce foreign keys unless you ask it to, and we ask.
   Production runs Postgres (see docker-compose.yml), which always enforces
   them -- a suite that leaves them off would pass locally and let referential
   bugs through to the deployed stack. That is exactly how issue #1 survived
   until the Docker switch.

3. Two things the app does deliberately slowly are made cheap for the whole
   session (`_skip_what_production_pays_for_on_purpose`). Together they were
   most of a ten-minute CI run (issue #169).
"""

import os

# Must be set before `web` is imported: it builds the engine at module scope.
os.environ.setdefault("DATABASE_URL", "sqlite://")
# The suite sends webhooks by calling outbound.deliver_due itself, against
# its own database; the app's loop would poll a different one (#91).
os.environ.setdefault("WEBHOOK_DELIVERY", "false")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from lib_softtrack.storage import LocalStorage, get_storage
from main import app
from web import get_session


@event.listens_for(Engine, "connect")
def _enforce_sqlite_foreign_keys(dbapi_connection, _record):
    """Make SQLite behave like Postgres about referential integrity."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


@pytest.fixture(scope="session", autouse=True)
def _skip_what_production_pays_for_on_purpose():
    """Make two deliberate production costs free for the suite.

    1. bcrypt at its default cost of 12 rounds takes about 0.2s per hash. That
       is the point in production, and pure overhead here, where every
       `auth()` registration and every login paid it and nothing checks how
       long a hash took. Four rounds is bcrypt's minimum and still a real
       hash: `checkpw` reads the cost from the hash itself, so verification
       and everything around it are exercised exactly as before.

    2. The lifespan runs `init_db` -- `alembic upgrade head` -- against the
       engine in `web`. Under DATABASE_URL=sqlite:// that is a brand-new
       in-memory database for every `TestClient`, so each test replayed all
       the migrations to build a schema nothing ever queried: the `session`
       fixture builds its own with `create_all`. The migrations are covered
       by tests/test_*migration*.py, which run Alembic against file-backed
       databases on purpose.

    Session-scoped so both are patched once. MonkeyPatch.context rather than
    the `monkeypatch` fixture, which is function-scoped and so unavailable
    from a session fixture.
    """
    import bcrypt
    import main

    real_gensalt = bcrypt.gensalt
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(
            bcrypt, "gensalt", lambda rounds=4, prefix=b"2b": real_gensalt(4, prefix)
        )
        patch.setattr(main, "init_db", lambda: None)
        yield


@pytest.fixture(autouse=True)
def _reset_auth_throttles():
    """Keep the login/registration counters from leaking between tests.

    They are module-level singletons, so without this a test that exhausts a
    budget would 429 the next test that happens to register a user -- and
    which test that is would depend on collection order.
    """
    from lib_utils.rate_limit import reset_all

    reset_all()
    yield
    reset_all()


@pytest.fixture(name="session")
def session_fixture():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    # A StaticPool keeps its one connection open until the engine is garbage
    # collected, and an engine sits in enough reference cycles that this is at
    # some arbitrary later test -- where Python 3.13+ reports the still-open
    # sqlite3 connection as a ResourceWarning against whatever was running.
    engine.dispose()


@pytest.fixture(name="storage")
def storage_fixture(tmp_path):
    """Attachment bytes go to a per-test directory.

    Overridden the same way the session is, so a test never writes into the
    working tree and two tests never see each other's files.
    """
    return LocalStorage(tmp_path / "attachments")


@pytest.fixture(name="client")
def client_fixture(session, storage):
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_storage] = lambda: storage
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


@pytest.fixture
def auth(client):
    """A registered user plus the headers to act as them."""

    def _register(email="demo@softtrack.dev", full_name="Demo User"):
        response = client.post(
            "/auth/register",
            json={"email": email, "password": "password123", "full_name": full_name},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        return {
            "user": body["user"],
            "headers": {"Authorization": f"Bearer {body['access_token']}"},
        }

    return _register


@pytest.fixture
def team(client, auth):
    """A user who owns one team, ready for issue tests.

    Carries the team's own statuses as `status_ids`, keyed by name. Statuses
    are rows per team rather than a fixed enum, so a test that wants an issue
    in "Done" has to say which team's Done it means. The names here are the
    default workflow every team is created with.
    """
    actor = auth()
    response = client.post(
        "/teams",
        json={"name": "Engineering", "key": "ENG"},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    created = response.json()
    return {
        **actor,
        "team": created,
        "status_ids": status_ids(client, actor, created["id"]),
    }


def status_ids(client, actor, team_id) -> dict[str, int]:
    """`{"Done": 5, ...}` for one team's board."""
    response = client.get(f"/teams/{team_id}/statuses", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return {row["name"]: row["id"] for row in response.json()}
