import asyncio
import time

from fastapi import BackgroundTasks, FastAPI
from fastapi.responses import StreamingResponse
from prometheus_client import REGISTRY

from lib_softtrack import comments as comments_service
from lib_softtrack import tickets as tickets_service
from lib_softtrack import teams as teams_service
from lib_softtrack.metrics import PrometheusMiddleware, check_metrics_token
from lib_softtrack.models.comments import CommentCreate
from lib_softtrack.models.tickets import TicketCreate
from lib_softtrack.models.teams import TeamCreate
from lib_softtrack.tables import User
from main import app
from web import settings


def sample(name: str, labels: dict[str, str] | None = None) -> float:
    return REGISTRY.get_sample_value(name, labels or {}) or 0.0


def asgi_get(
    target_app,
    path: str,
    headers: list[tuple[bytes, bytes]] | None = None,
    method: str = "GET",
):
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
                "method": method,
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
    assert asgi_get(app, "/metrics", [(b"authorization", b"Bearer \xff")])[0] == 401

    status, body = asgi_get(
        app, "/metrics", [(b"authorization", b"Bearer metrics-secret")]
    )

    assert status == 200
    assert b"softtrack_http_requests_total" in body


def test_metrics_accept_a_unicode_configured_token():
    check_metrics_token("Bearer токен", "токен")


def test_unknown_http_methods_use_a_bounded_label():
    routed = FastAPI()
    routed.add_middleware(PrometheusMiddleware)

    status, _body = asgi_get(routed, "/missing", method="BLAHBLAH")

    assert status == 404
    assert (
        sample(
            "softtrack_http_requests_total",
            {"method": "other", "route": "unmatched", "status": "404"},
        )
        >= 1
    )


def test_http_metrics_use_route_templates():
    routed = FastAPI()
    routed.add_middleware(PrometheusMiddleware)

    @routed.get("/tickets/{ticket_id}")
    async def get_ticket(ticket_id: int):
        return {"id": ticket_id}

    labels = {"method": "GET", "route": "/tickets/{ticket_id}", "status": "200"}
    before = sample("softtrack_http_requests_total", labels)

    status, _body = asgi_get(routed, "/tickets/123")

    assert status == 200
    assert sample("softtrack_http_requests_total", labels) == before + 1


def test_ticket_and_comment_creation_counters(session):
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
    tickets_before = sample("softtrack_tickets_created_total")
    comments_before = sample("softtrack_comments_created_total")

    ticket = tickets_service.create_ticket(
        session, actor, team.id, TicketCreate(title="Measure this")
    )
    comments_service.create_comment(
        session, actor, ticket.id, CommentCreate(body="Measured.")
    )

    assert sample("softtrack_tickets_created_total") == tickets_before + 1
    assert sample("softtrack_comments_created_total") == comments_before + 1


def test_a_refused_scrape_says_how_to_authenticate(client, monkeypatch):
    monkeypatch.setattr(settings, "metrics_token", "metrics-secret")

    response = client.get("/metrics")

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_no_token_is_a_404_with_a_code(client, monkeypatch):
    monkeypatch.setattr(settings, "metrics_token", "")

    response = client.get("/metrics")

    assert response.status_code == 404
    assert response.json()["code"] == "metrics_disabled"


def test_the_scrape_is_left_out_of_the_request_metrics(client, monkeypatch):
    monkeypatch.setattr(settings, "metrics_token", "metrics-secret")
    headers = {"Authorization": "Bearer metrics-secret"}
    client.get("/metrics", headers=headers)

    body = client.get("/metrics", headers=headers).text

    assert 'route="/metrics"' not in body


def test_background_work_is_not_the_request_s_latency():
    routed = FastAPI()
    routed.add_middleware(PrometheusMiddleware)

    @routed.post("/mail-later")
    def mail_later(background: BackgroundTasks):
        background.add_task(time.sleep, 0.5)
        return {"ok": True}

    labels = {"route": "/mail-later"}
    before = sample("softtrack_http_request_duration_seconds_sum", labels)

    status, _body = asgi_get(routed, "/mail-later", method="POST")

    assert status == 200
    assert sample("softtrack_http_request_duration_seconds_sum", labels) - before < 0.4


def test_an_event_stream_is_counted_but_not_timed():
    routed = FastAPI()
    routed.add_middleware(PrometheusMiddleware)

    @routed.get("/stream")
    def stream():
        return StreamingResponse(
            iter([b"data: hi\n\n"]), media_type="text/event-stream"
        )

    requests = {"method": "GET", "route": "/stream", "status": "200"}
    before = sample("softtrack_http_requests_total", requests)

    assert asgi_get(routed, "/stream")[0] == 200

    assert sample("softtrack_http_requests_total", requests) == before + 1
    assert (
        sample("softtrack_http_request_duration_seconds_count", {"route": "/stream"})
        == 0
    )


def test_a_client_that_leaves_before_the_answer_is_disconnected_not_500():
    async def hangs(scope, receive, send):
        raise asyncio.CancelledError

    labels = {"method": "GET", "route": "unmatched", "status": "disconnected"}
    before = sample("softtrack_http_requests_total", labels)

    try:
        asgi_get(PrometheusMiddleware(hangs), "/anything")
    except asyncio.CancelledError:
        pass

    assert sample("softtrack_http_requests_total", labels) == before + 1
