"""Prometheus metrics for operators running SoftTrack themselves."""

import time

from fastapi import Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from starlette.types import ASGIApp, Message, Receive, Scope, Send

HTTP_REQUESTS = Counter(
    "softtrack_http_requests_total",
    "HTTP requests served by SoftTrack.",
    ("method", "route", "status"),
)
HTTP_REQUEST_DURATION = Histogram(
    "softtrack_http_request_duration_seconds",
    "HTTP request duration in seconds.",
    ("method", "route", "status"),
)

ISSUES_CREATED = Counter(
    "softtrack_issues_created_total",
    "Issues created in SoftTrack.",
)
COMMENTS_CREATED = Counter(
    "softtrack_comments_created_total",
    "Comments created in SoftTrack.",
)

NOTIFICATION_DIGEST_SENDS = Counter(
    "softtrack_notification_digest_sends_total",
    "Notification digest email send attempts.",
    ("result",),
)
NOTIFICATION_DIGEST_PENDING = Gauge(
    "softtrack_notification_digest_pending_notifications",
    "Notifications eligible for the most recent digest tick.",
)

WEBHOOK_DELIVERIES_IN = Counter(
    "softtrack_webhook_deliveries_in_total",
    "Webhook deliveries received by SoftTrack.",
    ("provider", "event"),
)
WEBHOOK_DELIVERIES_OUT = Counter(
    "softtrack_webhook_deliveries_out_total",
    "Webhook deliveries processed by SoftTrack.",
    ("provider", "event", "result"),
)


def metrics_response() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


def _route_template(scope: Scope) -> str:
    route = scope.get("route")
    path = getattr(route, "path", None)
    if isinstance(path, str):
        return path
    return "unmatched"


class PrometheusMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()
        status = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            labels = {
                "method": scope["method"],
                "route": _route_template(scope),
                "status": str(status),
            }
            HTTP_REQUESTS.labels(**labels).inc()
            HTTP_REQUEST_DURATION.labels(**labels).observe(time.perf_counter() - start)
