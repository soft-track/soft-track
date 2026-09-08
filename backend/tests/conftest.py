"""Test fixtures.

Two decisions worth knowing about:

1. Each test gets a fresh in-memory SQLite database on a StaticPool, so the
   whole test runs against one connection and nothing leaks between tests.

2. SQLite does not enforce foreign keys unless you ask it to, and we ask.
   Production runs Postgres (see docker-compose.yml), which always enforces
   them -- a suite that leaves them off would pass locally and let referential
   bugs through to the deployed stack. That is exactly how issue #1 survived
   until the Docker switch.
"""

import os

# Must be set before `web` is imported: it builds the engine at module scope.
os.environ.setdefault("DATABASE_URL", "sqlite://")

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
