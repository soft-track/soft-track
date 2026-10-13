"""Prometheus metrics for operators running SoftTrack themselves."""

import asyncio
import secrets
import time

from fastapi import Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Histogram,
    generate_latest,
)
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from lib_utils.errors import ErrorCode, api_error

HTTP_REQUESTS = Counter(
    "softtrack_http_requests_total",
    "Requests handled, by route template.",
    ("method", "route", "status"),
)
# By route only: the method and status breakdown is on the counter above, and
# carrying it here would multiply every route's buckets by both.
HTTP_REQUEST_DURATION = Histogram(
    "softtrack_http_request_duration_seconds",
    "Time to respond, by route template.",
    ("route",),
)

TICKETS_CREATED = Counter(
    "softtrack_tickets_created_total",
    "Tickets created.",
)
# Posted by people, here or in a Jira import. A rule's comment and the note a
# move leaves are not counted: they say what happened, nobody posted them.
COMMENTS_CREATED = Counter(
    "softtrack_comments_created_total",
    "Comments posted by people.",
)

DIGEST_SENDS = Counter(
    "softtrack_digest_sends_total",
    "Notification digests, by result.",
    ("result",),
)
DIGEST_SENDS.labels(result="success")
DIGEST_SENDS.labels(result="failure")

#: Incoming code-host deliveries are `in` (accepted, rejected or throttled);
#: SoftTrack's own outgoing webhooks are `out`, one count per attempt.
WEBHOOK_DELIVERIES = Counter(
    "softtrack_webhook_deliveries_total",
    "Webhooks, in and out.",
    ("direction", "result"),
)
for _direction, _result in (
    ("in", "accepted"),
    ("in", "rejected"),
    ("in", "throttled"),
    ("out", "success"),
    ("out", "failure"),
):
    WEBHOOK_DELIVERIES.labels(direction=_direction, result=_result)

_KNOWN_METHODS = frozenset(
    {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"}
)

#: The scrape itself is left out of the request metrics.
_UNMEASURED_ROUTES = frozenset({"/metrics"})


def _method_label(method: str) -> str:
    return method if method in _KNOWN_METHODS else "other"


def check_metrics_token(authorization: str | None, configured_token: str) -> None:
    """404 while no token is configured, so the route does not exist; 401 for
    a missing or wrong one, compared in constant time."""
    if not configured_token:
        raise api_error(
            status_code=404,
            code=ErrorCode.metrics_disabled,
            detail="Not found",
        )
    expected = f"Bearer {configured_token}"
    if authorization is None or not secrets.compare_digest(
        authorization.encode("utf-8"), expected.encode("utf-8")
    ):
        raise api_error(
            status_code=401,
            code=ErrorCode.not_authenticated,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )


def metrics_response() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


def _route_template(scope: Scope) -> str:
    route = scope.get("route")
    path = getattr(route, "path", None)
    if isinstance(path, str):
        return path
    return "unmatched"


def _is_event_stream(headers) -> bool:
    for name, value in headers or ():
        if name.lower() == b"content-type":
            return value.split(b";")[0].strip().lower() == b"text/event-stream"
    return False


class PrometheusMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()
        # When the last of the body went out. Background tasks run after it
        # and before the app returns; they are not the client's wait.
        finished: float | None = None
        status: int | str = 500
        response_started = False
        # A server-sent event stream stays open for hours: one observation of
        # that length would swamp the route's latency.
        streaming = False

        async def send_wrapper(message: Message) -> None:
            nonlocal response_started, status, finished, streaming
            if message["type"] == "http.response.start":
                status = message["status"]
                response_started = True
                streaming = _is_event_stream(message.get("headers"))
            elif message["type"] == "http.response.body" and not message.get(
                "more_body", False
            ):
                finished = time.perf_counter()
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except asyncio.CancelledError:
            if not response_started:
                status = "disconnected"
            raise
        finally:
            route = _route_template(scope)
            if route not in _UNMEASURED_ROUTES:
                HTTP_REQUESTS.labels(
                    method=_method_label(scope["method"]),
                    route=route,
                    status=str(status),
                ).inc()
                if not streaming:
                    end = finished if finished is not None else time.perf_counter()
                    HTTP_REQUEST_DURATION.labels(route=route).observe(end - start)
