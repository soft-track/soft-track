"""Outbound webhooks (issue #91).

Deliveries are sent by calling `outbound.deliver_due` with a fake sender, so
these see exactly what would go over the wire -- URL, headers, the signed
body -- without any network. The target URL is an IP literal, which needs no
DNS; the tests about DNS pass their own resolver.
"""

import hashlib
import hmac
import json
import socket
from datetime import timedelta

import pytest
from sqlmodel import select

from lib_softtrack import outbound
from lib_softtrack.tables import OutboundWebhook, WebhookDelivery, utcnow
from web import settings

PUBLIC = "https://93.184.216.34/softtrack"


class FakeReceiver:
    """Answers every POST with `status`, and remembers what it was sent."""

    def __init__(self, status=200, text="ok"):
        self.status, self.text, self.calls = status, text, []

    def __call__(self, url, headers, body):
        self.calls.append({"url": url, "headers": headers, "body": body})
        return self.status, self.text

    def events(self):
        return [call["headers"]["X-SoftTrack-Event"] for call in self.calls]

    def payloads(self):
        return [json.loads(call["body"]) for call in self.calls]


def make_hook(client, team, events=("issue.created",), expect=200, **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/outbound-webhooks",
        json={"url": PUBLIC, "events": list(events), **fields},
        headers=team["headers"],
    )
    assert response.status_code == expect, response.text
    return response.json()


def make_issue(client, team, title="Work", **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def deliver(session, receiver, now=None):
    session.expire_all()
    return outbound.deliver_due(session, sender=receiver, now=now)


# --- configuring --------------------------------------------------------------


def test_the_secret_is_shown_once(client, team):
    created = make_hook(client, team)
    assert created["secret"].startswith("whsec_")
    [listed] = client.get(
        f"/teams/{team['team']['id']}/outbound-webhooks", headers=team["headers"]
    ).json()
    assert "secret" not in listed
    assert listed["secret_hint"] == "whsec_…" + created["secret"][-4:]


def test_only_team_admins_manage_webhooks(client, team, auth):
    member = auth(email="member@softtrack.dev", full_name="Member")
    client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )
    response = client.post(
        f"/teams/{team['team']['id']}/outbound-webhooks",
        json={"url": PUBLIC, "events": ["issue.created"]},
        headers=member["headers"],
    )
    assert response.status_code == 403


def test_at_least_one_event(client, team):
    assert make_hook(client, team, events=(), expect=422)["code"] == "webhook_invalid"


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/hook",
        "http://10.0.0.5/hook",
        "http://192.168.1.10/hook",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/hook",
        "http://[::ffff:127.0.0.1]/hook",
        "http://localhost:8000/hook",
        "http://0.0.0.0/hook",
    ],
)
def test_private_targets_are_refused(client, team, url):
    response = client.post(
        f"/teams/{team['team']['id']}/outbound-webhooks",
        json={"url": url, "events": ["issue.created"]},
        headers=team["headers"],
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "webhook_target_private"


def test_only_http_and_https(client, team):
    response = client.post(
        f"/teams/{team['team']['id']}/outbound-webhooks",
        json={"url": "file:///etc/passwd", "events": ["issue.created"]},
        headers=team["headers"],
    )
    assert response.status_code == 422
    assert response.json()["code"] == "webhook_invalid"


def test_the_escape_hatch_allows_an_internal_target(client, team, monkeypatch):
    monkeypatch.setattr(settings, "webhook_allow_private_targets", True)
    make_hook(client, team, url="http://10.0.0.5/slack-proxy")


# --- what is sent -------------------------------------------------------------


def test_an_event_is_signed_and_delivered_off_the_request(client, team, session):
    hook = make_hook(client, team)
    issue = make_issue(client, team, "Ship it")
    receiver = FakeReceiver()

    # Nothing has gone anywhere during the request itself.
    assert receiver.calls == []
    assert deliver(session, receiver) == 1

    [call] = receiver.calls
    assert call["url"] == PUBLIC
    headers, body = call["headers"], call["body"]
    expected = (
        "sha256=" + hmac.new(hook["secret"].encode(), body, hashlib.sha256).hexdigest()
    )
    assert headers["X-SoftTrack-Signature"] == expected
    assert headers["X-SoftTrack-Event"] == "issue.created"
    assert headers["Content-Type"] == "application/json"

    payload = json.loads(body)
    assert payload["event"] == "issue.created"
    assert payload["team"]["key"] == "ENG"
    assert payload["actor"]["id"] == team["user"]["id"]
    assert payload["data"]["issue"]["identifier"] == issue["identifier"]

    [row] = session.exec(select(WebhookDelivery)).all()
    assert (row.status, row.attempts, row.response_status) == ("succeeded", 1, 200)


def test_only_subscribed_events_are_queued(client, team, session):
    make_hook(client, team, events=("comment.created",))
    make_issue(client, team)
    assert session.exec(select(WebhookDelivery)).all() == []


def test_an_update_says_what_changed_and_a_status_change_says_so_too(
    client, team, session
):
    make_hook(client, team, events=("issue.updated", "issue.status_changed"))
    issue = make_issue(client, team)
    client.patch(
        f"/issues/{issue['id']}",
        json={"status_id": team["status_ids"]["Done"], "priority": "high"},
        headers=team["headers"],
    )
    receiver = FakeReceiver()
    deliver(session, receiver)

    assert sorted(receiver.events()) == ["issue.status_changed", "issue.updated"]
    updated = next(p for p in receiver.payloads() if p["event"] == "issue.updated")
    assert updated["data"]["changes"]["priority"] == {
        "from": "no_priority",
        "to": "high",
    }
    moved = next(p for p in receiver.payloads() if p["event"] == "issue.status_changed")
    assert moved["data"]["to"]["name"] == "Done"


def test_a_patch_that_changes_nothing_sends_nothing(client, team, session):
    make_hook(client, team, events=("issue.updated",))
    issue = make_issue(client, team, priority="high")
    client.patch(
        f"/issues/{issue['id']}", json={"priority": "high"}, headers=team["headers"]
    )
    assert session.exec(select(WebhookDelivery)).all() == []


def test_comments_and_cycles(client, team, session):
    make_hook(
        client,
        team,
        events=("comment.created", "cycle.started", "cycle.completed"),
    )
    issue = make_issue(client, team)
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "Looks good"},
        headers=team["headers"],
    )
    cycle = client.post(
        f"/teams/{team['team']['id']}/cycles",
        json={"starts_at": "2026-09-01", "ends_at": "2026-09-14"},
        headers=team["headers"],
    ).json()
    client.post(f"/cycles/{cycle['id']}/start", headers=team["headers"])
    client.post(f"/cycles/{cycle['id']}/complete", headers=team["headers"])

    receiver = FakeReceiver()
    deliver(session, receiver)
    assert receiver.events() == ["comment.created", "cycle.started", "cycle.completed"]
    assert receiver.payloads()[0]["data"]["comment"]["body"] == "Looks good"


def test_a_rules_change_arrives_separately_with_no_actor(client, team, session):
    make_hook(client, team, events=("issue.updated",))
    client.post(
        f"/teams/{team['team']['id']}/automation-rules",
        json={
            "name": "Urgent when started",
            "trigger": "status_changed",
            "conditions": {"if_status_id": team["status_ids"]["In Progress"]},
            "actions": {"set_priority": "urgent"},
        },
        headers=team["headers"],
    )
    issue = make_issue(client, team)
    client.patch(
        f"/issues/{issue['id']}",
        json={"status_id": team["status_ids"]["In Progress"]},
        headers=team["headers"],
    )
    receiver = FakeReceiver()
    deliver(session, receiver)
    actors = [p["actor"] for p in receiver.payloads()]
    assert actors[0]["id"] == team["user"]["id"]
    assert actors[1] is None
    assert receiver.payloads()[1]["data"]["changes"]["priority"]["to"] == "urgent"


# --- retries, failures, switching off -------------------------------------------


def test_a_failure_is_retried_with_backoff_then_given_up(client, team, session):
    make_hook(client, team)
    make_issue(client, team)
    failing = FakeReceiver(status=500, text="boom")
    start = utcnow()

    deliver(session, failing, now=start)
    [row] = session.exec(select(WebhookDelivery)).all()
    assert (row.status, row.attempts) == ("pending", 1)
    # Not due again yet.
    assert deliver(session, failing, now=start + timedelta(seconds=10)) == 0

    at = start
    for gap in outbound.BACKOFF:
        at = at + gap + timedelta(seconds=1)
        assert deliver(session, failing, now=at) == 1

    session.expire_all()
    [row] = session.exec(select(WebhookDelivery)).all()
    assert (row.status, row.attempts) == ("failed", outbound.MAX_ATTEMPTS)
    assert row.response_excerpt == "boom"
    assert session.exec(select(OutboundWebhook)).one().consecutive_failures == 1


def _fail_completely(session, receiver, start):
    at = start
    deliver(session, receiver, now=at)
    for gap in outbound.BACKOFF:
        at = at + gap + timedelta(seconds=1)
        deliver(session, receiver, now=at)


def test_repeated_failure_switches_the_webhook_off_visibly(client, team, session):
    hook = make_hook(client, team)
    failing = FakeReceiver(status=503)
    for n in range(outbound.DISABLE_AFTER):
        make_issue(client, team, f"#{n}")
        _fail_completely(session, failing, utcnow())

    [listed] = client.get(
        f"/teams/{team['team']['id']}/outbound-webhooks", headers=team["headers"]
    ).json()
    assert listed["is_enabled"] is False
    assert "failed every retry" in listed["disabled_reason"]

    # Switched off: nothing more is queued.
    make_issue(client, team, "After")
    session.expire_all()
    pending = session.exec(
        select(WebhookDelivery).where(WebhookDelivery.status == "pending")
    ).all()
    assert pending == []

    # Turning it back on starts afresh.
    turned_on = client.patch(
        f"/outbound-webhooks/{hook['id']}",
        json={"is_enabled": True},
        headers=team["headers"],
    ).json()
    assert (turned_on["consecutive_failures"], turned_on["disabled_reason"]) == (
        0,
        None,
    )


def test_a_success_resets_the_failure_count(client, team, session):
    make_hook(client, team)
    make_issue(client, team, "Fails")
    _fail_completely(session, FakeReceiver(status=500), utcnow())
    make_issue(client, team, "Works")
    deliver(session, FakeReceiver())
    session.expire_all()
    assert session.exec(select(OutboundWebhook)).one().consecutive_failures == 0


def test_a_host_that_turns_private_after_saving_is_not_sent_to(
    client, team, session, monkeypatch
):
    """DNS can change between saving the URL and sending to it."""
    public = lambda host, port, **kw: [  # noqa: E731
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))
    ]
    monkeypatch.setattr(outbound.socket, "getaddrinfo", public)
    make_hook(client, team, url="https://hooks.example.com/softtrack")
    make_issue(client, team)

    rebound = lambda host, port, **kw: [  # noqa: E731
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.7", port))
    ]
    receiver = FakeReceiver()
    session.expire_all()
    outbound.deliver_due(session, sender=receiver, resolve=rebound)
    assert receiver.calls == []
    [row] = session.exec(select(WebhookDelivery)).all()
    assert "private" in row.response_excerpt


def test_two_workers_never_send_the_same_delivery(client, team, session):
    make_hook(client, team)
    make_issue(client, team)
    [row] = session.exec(select(WebhookDelivery)).all()
    now = utcnow()
    assert outbound._claim(session, [row.id], now) == [row.id]
    assert outbound._claim(session, [row.id], now) == []


# --- the log and the ping ---------------------------------------------------------


def test_the_log_shows_what_the_receiver_said(client, team, session):
    hook = make_hook(client, team)
    make_issue(client, team)
    deliver(session, FakeReceiver(status=410, text="Gone for good"))
    [entry] = client.get(
        f"/outbound-webhooks/{hook['id']}/deliveries", headers=team["headers"]
    ).json()
    assert (entry["event"], entry["response_status"]) == ("issue.created", 410)
    assert entry["response_excerpt"] == "Gone for good"


def test_a_ping_checks_the_url_and_secret(client, team, session):
    hook = make_hook(client, team, events=("comment.created",))
    response = client.post(
        f"/outbound-webhooks/{hook['id']}/ping", headers=team["headers"]
    )
    assert response.status_code == 202
    receiver = FakeReceiver()
    deliver(session, receiver)
    assert receiver.events() == ["ping"]


def test_deleting_a_webhook_takes_its_log(client, team, session):
    hook = make_hook(client, team)
    make_issue(client, team)
    response = client.delete(
        f"/outbound-webhooks/{hook['id']}", headers=team["headers"]
    )
    assert response.status_code == 204
    assert session.exec(select(WebhookDelivery)).all() == []


# --- the real HTTP client -------------------------------------------------------------


@pytest.fixture
def local_receiver(monkeypatch):
    """A real HTTP server on loopback -- allowed only through the escape hatch.

    `/hook` answers 200; `/redirect` answers 302 to `/internal`, which records
    it was reached, so a test can see whether the redirect was followed.
    """
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    received = {"hook": [], "internal": 0}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802 -- http.server's naming
            body = self.rfile.read(int(self.headers["Content-Length"]))
            if self.path == "/redirect":
                self.send_response(302)
                self.send_header("Location", "/internal")
                self.end_headers()
                return
            if self.path == "/internal":
                received["internal"] += 1
            received["hook"].append((dict(self.headers), body))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"thanks")

        do_GET = do_POST  # noqa: N815

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(settings, "webhook_allow_private_targets", True)
    yield f"http://127.0.0.1:{server.server_address[1]}", received
    server.shutdown()
    server.server_close()


def test_a_real_delivery_arrives_signed(client, team, session, local_receiver):
    base, received = local_receiver
    hook = make_hook(client, team, url=f"{base}/hook")
    make_issue(client, team)
    session.expire_all()
    outbound.deliver_due(session)

    [(headers, body)] = received["hook"]
    signature = {k.lower(): v for k, v in headers.items()}["x-softtrack-signature"]
    assert (
        signature
        == "sha256="
        + hmac.new(hook["secret"].encode(), body, hashlib.sha256).hexdigest()
    )
    [row] = session.exec(select(WebhookDelivery)).all()
    assert (row.status, row.response_excerpt) == ("succeeded", "thanks")


def test_a_redirect_is_not_followed(client, team, session, local_receiver):
    """A 3xx to an internal address is how a forgery would get past the
    address check, so it is a failed attempt, never a second request."""
    base, received = local_receiver
    make_hook(client, team, url=f"{base}/redirect")
    make_issue(client, team)
    session.expire_all()
    outbound.deliver_due(session)

    assert received["internal"] == 0
    [row] = session.exec(select(WebhookDelivery)).all()
    assert (row.status, row.response_status) == ("pending", 302)
