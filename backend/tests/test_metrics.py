import asyncio

from fastapi import FastAPI
from prometheus_client import REGISTRY

from lib_softtrack import comments as comments_service
from lib_softtrack import issues as issues_service
from lib_softtrack import teams as teams_service
from lib_softtrack.metrics import PrometheusMiddleware
from lib_softtrack.models.comments import CommentCreate
from lib_softtrack.models.issues import IssueCreate
from lib_softtrack.models.teams import TeamCreate
from lib_softtrack.tables import User
from main import app
from web import settings


def sample(name: str, labels: dict[str, str] | None = None) -> float:
    return REGISTRY.get_sample_value(name, labels or {}) or 0.0


def asgi_get(target_app, path: str, headers: list[tuple[bytes, bytes]] | None = None):
    async def run():
        messages = []
        received = False

        async def receive():
            nonlocal received
            if received:
                return {"type": "http.disconnect"}
            received = True
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            messages.append(message)

        await target_app(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "method": "GET",
                "path": path,
                "root_path": "",
                "scheme": "http",
                "server": ("testserver", 80),
                "client": ("testclient", 50000),
                "raw_path": path.encode(),
                "query_string": b"",
                "headers": headers or [],
            },
            receive,
            send,
        )
        return messages

    messages = asyncio.run(run())
    start = next(
        message for message in messages if message["type"] == "http.response.start"
    )
    body = b"".join(
        message.get("body", b"")
        for message in messages
        if message["type"] == "http.response.body"
    )
    return start["status"], body


def test_metrics_are_hidden_until_a_token_is_configured(monkeypatch):
    monkeypatch.setattr(settings, "metrics_token", "")

    status, _body = asgi_get(app, "/metrics")

    assert status == 404


def test_metrics_require_the_configured_bearer_token(monkeypatch):
    monkeypatch.setattr(settings, "metrics_token", "metrics-secret")

    assert asgi_get(app, "/metrics")[0] == 401
    assert asgi_get(app, "/metrics", [(b"authorization", b"Bearer wrong")])[0] == 401

    status, body = asgi_get(
        app, "/metrics", [(b"authorization", b"Bearer metrics-secret")]
    )

    assert status == 200
    assert b"softtrack_http_requests_total" in body


def test_http_metrics_use_route_templates():
    routed = FastAPI()
    routed.add_middleware(PrometheusMiddleware)

    @routed.get("/issues/{issue_id}")
    async def get_issue(issue_id: int):
        return {"id": issue_id}

    labels = {"method": "GET", "route": "/issues/{issue_id}", "status": "200"}
    before = sample("softtrack_http_requests_total", labels)

    status, _body = asgi_get(routed, "/issues/123")

    assert status == 200
    assert sample("softtrack_http_requests_total", labels) == before + 1


def test_issue_and_comment_creation_counters(session):
    actor = User(
        email="metrics@softtrack.dev",
        username="metrics",
        hashed_password="hash",
        full_name="Metrics User",
    )
    session.add(actor)
    session.commit()
    session.refresh(actor)
    team = teams_service.create_team(
        session, actor, TeamCreate(name="Engineering", key="ENG")
    )
    issues_before = sample("softtrack_issues_created_total")
    comments_before = sample("softtrack_comments_created_total")

    issue = issues_service.create_issue(
        session, actor, team.id, IssueCreate(title="Measure this")
    )
    comments_service.create_comment(
        session, actor, issue.id, CommentCreate(body="Measured.")
    )

    assert sample("softtrack_issues_created_total") == issues_before + 1
    assert sample("softtrack_comments_created_total") == comments_before + 1
