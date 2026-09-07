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

from main import app
from web import get_session


@event.listens_for(Engine, "connect")
def _enforce_sqlite_foreign_keys(dbapi_connection, _record):
    """Make SQLite behave like Postgres about referential integrity."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


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


@pytest.fixture(name="client")
def client_fixture(session):
    app.dependency_overrides[get_session] = lambda: session
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
    """A user who owns one team, ready for issue tests."""
    actor = auth()
    response = client.post(
        "/teams",
        json={"name": "Engineering", "key": "ENG"},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return {**actor, "team": response.json()}
