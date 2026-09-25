"""Real-time invalidation events (#103).

Two halves. The first drives the real API with a recording bus in place and
checks which nudges each write produces -- the listener on the ORM is the
part that decides, and it is plain synchronous code. The second opens the
stream itself and reads it.
"""

import asyncio
import json
from datetime import date

import pytest

from lib_softtrack import realtime
from lib_softtrack.realtime import Event, InProcessBus


class RecordingBus:
    def __init__(self):
        self.sent: list[tuple[str, str, dict]] = []

    def publish(self, channel, event):
        self.sent.append((channel, event.name, json.loads(event.body)))

    def subscribe(self, channels):  # pragma: no cover -- not used here
        raise NotImplementedError

    def names(self, channel=None):
        return [(c, n, d) for c, n, d in self.sent if channel is None or c == channel]


@pytest.fixture
def recorded(monkeypatch):
    realtime.install()
    bus = RecordingBus()
    monkeypatch.setattr(realtime, "bus", bus)
    return bus


def make_issue(client, actor, team_id, **fields):
    response = client.post(
        f"/teams/{team_id}/issues",
        json={"title": "Flaky test", **fields},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def join(client, team, person, role="member"):
    client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": person["user"]["email"], "role": role},
        headers=team["headers"],
    )


# --- what produces which nudge -----------------------------------------------


def test_creating_and_editing_an_issue_announce_it_to_its_team(client, team, recorded):
    team_channel = f"team:{team['team']['id']}"
    issue = make_issue(client, team, team["team"]["id"])
    assert (team_channel, "issue_changed", {"id": issue["id"]}) in recorded.sent

    recorded.sent.clear()
    client.patch(
        f"/issues/{issue['id']}", json={"priority": "high"}, headers=team["headers"]
    )
    assert recorded.names(team_channel) == [
        (team_channel, "issue_changed", {"id": issue["id"]})
    ]


def test_one_transaction_announces_an_issue_once(client, team, recorded):
    """Creating an issue flushes it more than once; the board refetches once."""
    make_issue(client, team, team["team"]["id"], label_ids=[])
    changed = [e for e in recorded.sent if e[1] == "issue_changed"]
    assert len(changed) == len({json.dumps(e) for e in changed})


def test_a_comment_is_announced_as_one(client, team, recorded):
    issue = make_issue(client, team, team["team"]["id"])
    recorded.sent.clear()
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "On it"},
        headers=team["headers"],
    )
    assert (
        f"team:{team['team']['id']}",
        "comment_added",
        {"issue_id": issue["id"]},
    ) in recorded.sent


def test_a_reaction_refreshes_the_thread(client, team, recorded):
    issue = make_issue(client, team, team["team"]["id"])
    comment = client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "On it"},
        headers=team["headers"],
    ).json()
    recorded.sent.clear()
    client.put(f"/comments/{comment['id']}/reactions/heart", headers=team["headers"])
    assert recorded.names() == [
        (f"team:{team['team']['id']}", "comment_added", {"issue_id": issue["id"]})
    ]


def test_time_labels_and_links_refresh_the_issue(client, team, recorded):
    team_id = team["team"]["id"]
    channel = f"team:{team_id}"
    issue = make_issue(client, team, team_id)
    other = make_issue(client, team, team_id, title="Other")
    label = client.post(
        f"/teams/{team_id}/labels",
        json={"name": "ci", "color": "#123456"},
        headers=team["headers"],
    ).json()

    for do in (
        lambda: client.post(
            f"/issues/{issue['id']}/worklogs",
            json={"minutes": 5},
            headers=team["headers"],
        ),
        lambda: client.patch(
            f"/issues/{issue['id']}",
            json={"label_ids": [label["id"]]},
            headers=team["headers"],
        ),
    ):
        recorded.sent.clear()
        do()
        assert (channel, "issue_changed", {"id": issue["id"]}) in recorded.sent

    recorded.sent.clear()
    client.post(
        f"/issues/{issue['id']}/links",
        json={"target_id": other["id"], "type": "blocks"},
        headers=team["headers"],
    )
    changed = {d["id"] for c, n, d in recorded.sent if n == "issue_changed"}
    assert changed == {issue["id"], other["id"]}


def test_a_move_between_teams_reaches_both_boards(client, team, recorded):
    ops = client.post(
        "/teams", json={"name": "Ops", "key": "OPS"}, headers=team["headers"]
    ).json()
    issue = make_issue(client, team, team["team"]["id"])
    recorded.sent.clear()
    client.post(
        f"/issues/{issue['id']}/transfer",
        json={"team_id": ops["id"]},
        headers=team["headers"],
    )
    channels = {
        c
        for c, n, d in recorded.sent
        if n == "issue_changed" and d == {"id": issue["id"]}
    }
    assert channels == {f"team:{team['team']['id']}", f"team:{ops['id']}"}


def test_a_notification_goes_to_its_recipient_only(client, team, auth, recorded):
    maya = auth(email="maya@softtrack.dev", full_name="Maya Chen")
    join(client, team, maya)
    issue = make_issue(client, team, team["team"]["id"])
    recorded.sent.clear()
    client.patch(
        f"/issues/{issue['id']}",
        json={"assignee_id": maya["user"]["id"]},
        headers=team["headers"],
    )
    assert (f"user:{maya['user']['id']}", "notification", {}) in recorded.sent
    assert not [e for e in recorded.sent if e[0] == f"user:{team['user']['id']}"]


def test_nothing_is_announced_for_a_write_that_failed(client, team, recorded):
    issue = make_issue(client, team, team["team"]["id"])
    recorded.sent.clear()
    # A claim of someone else's attachment fails after the comment is flushed.
    response = client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "with a file", "attachment_ids": [999]},
        headers=team["headers"],
    )
    assert response.status_code >= 400
    assert recorded.sent == []


def test_losing_access_closes_the_stream(client, team, auth, recorded):
    maya = auth(email="maya@softtrack.dev", full_name="Maya Chen")
    join(client, team, maya)
    recorded.sent.clear()
    client.delete(
        f"/teams/{team['team']['id']}/members/{maya['user']['id']}",
        headers=team["headers"],
    )
    assert (
        f"user:{maya['user']['id']}",
        "close",
        {"team_id": team["team"]["id"]},
    ) in recorded.sent

    recorded.sent.clear()
    response = client.post("/auth/me/sign-out-everywhere", headers=team["headers"])
    assert response.status_code == 200, response.text
    assert (f"user:{team['user']['id']}", "close", {}) in recorded.sent


# --- the bus -----------------------------------------------------------------


def test_the_bus_delivers_across_threads_and_resyncs_a_stream_that_fell_behind(
    monkeypatch,
):
    monkeypatch.setattr(realtime, "QUEUE_LIMIT", 3)

    async def scenario():
        bus = InProcessBus()
        subscription = bus.subscribe(["team:1"])
        # Published from another thread, as a sync route handler would.
        await asyncio.to_thread(bus.publish, "team:1", Event.of("issue_changed", id=7))
        await asyncio.to_thread(bus.publish, "team:2", Event.of("issue_changed", id=8))
        first = await subscription.next(1)

        for number in range(10):
            bus.publish("team:1", Event.of("issue_changed", id=number))
        await asyncio.sleep(0)
        queued = [
            await subscription.next(0.1) for _ in range(subscription.queue.qsize())
        ]
        subscription.close()
        return first, queued, bus.subscriber_count(), await subscription.next(0.01)

    first, queued, remaining, after_close = asyncio.run(scenario())
    assert first == Event.of("issue_changed", id=7)
    assert realtime.RESYNC in queued
    assert len(queued) <= 3
    assert remaining == 0
    assert after_close is None


# --- the stream --------------------------------------------------------------


class Stream:
    """Drive the app over raw ASGI, reading the body as it arrives.

    TestClient and httpx's ASGI transport both wait for a response to finish
    before handing it over, and an event stream does not finish -- so the
    stream test talks to the app the way uvicorn does.
    """

    def __init__(self, path, headers):
        self.path = path
        self.headers = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
        self.start: dict = {}
        self.chunks: asyncio.Queue = asyncio.Queue()
        self.disconnect = asyncio.Event()

    async def run(self):
        from main import app

        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": self.path,
            "raw_path": self.path.encode(),
            "query_string": b"",
            "headers": self.headers,
            "client": ("127.0.0.1", 1234),
            "server": ("test", 80),
        }
        sent_request = False

        async def receive():
            nonlocal sent_request
            if not sent_request:
                sent_request = True
                return {"type": "http.request", "body": b"", "more_body": False}
            await self.disconnect.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            if message["type"] == "http.response.start":
                self.start = message
            elif message["type"] == "http.response.body":
                await self.chunks.put(message.get("body", b"").decode())

        await app(scope, receive, send)

    async def frames_until(self, done, timeout=5):
        frames, buffer = [], ""
        while not done(frames):
            buffer += await asyncio.wait_for(self.chunks.get(), timeout)
            while "\n\n" in buffer:
                frame, buffer = buffer.split("\n\n", 1)
                frames.append(frame)
        return frames


def test_the_stream_needs_membership(client, auth, team):
    stranger = auth(email="stranger@softtrack.dev", full_name="Stranger")
    response = client.get(
        f"/teams/{team['team']['id']}/events", headers=stranger["headers"]
    )
    assert response.status_code == 403


def test_the_stream_carries_nudges_and_heartbeats_and_ends_on_close(
    client, team, monkeypatch
):
    from app_softtrack import events as events_route

    monkeypatch.setattr(events_route, "HEARTBEAT_SECONDS", 0.05)
    team_id = team["team"]["id"]
    user_id = team["user"]["id"]

    async def scenario():
        stream = Stream(f"/teams/{team_id}/events", team["headers"])
        task = asyncio.create_task(stream.run())
        opening = await stream.frames_until(lambda f: ": ping" in f)

        realtime.bus.publish(f"team:{team_id}", Event.of("issue_changed", id=42))
        realtime.bus.publish(f"team:{team_id + 99}", Event.of("issue_changed", id=43))
        # Leaving some other team is not this stream's business.
        realtime.bus.publish(f"user:{user_id}", Event.of("close", team_id=team_id + 99))
        realtime.bus.publish(f"user:{user_id}", Event.of("close", team_id=team_id))
        rest = await stream.frames_until(
            lambda f: any(x.startswith("event: close") for x in f)
        )
        await asyncio.wait_for(task, 5)  # the stream ended itself
        return stream.start, opening, rest

    start, opening, rest = asyncio.run(scenario())
    headers = dict(start["headers"])
    assert start["status"] == 200
    assert headers[b"content-type"].startswith(b"text/event-stream")
    assert headers[b"x-accel-buffering"] == b"no"
    assert opening[0] == "retry: 5000\n: connected"
    assert [frame for frame in rest if frame.startswith("event:")] == [
        'event: issue_changed\ndata: {"id": 42}',
        f'event: close\ndata: {{"team_id": {team_id}}}',
    ]
    assert realtime.bus.subscriber_count() == 0


def test_a_disconnect_unsubscribes(client, team, monkeypatch):
    from app_softtrack import events as events_route

    monkeypatch.setattr(events_route, "HEARTBEAT_SECONDS", 0.05)

    async def scenario():
        stream = Stream(f"/teams/{team['team']['id']}/events", team["headers"])
        task = asyncio.create_task(stream.run())
        await stream.frames_until(lambda f: len(f) >= 1)
        during = realtime.bus.subscriber_count()
        stream.disconnect.set()
        await asyncio.wait_for(task, 5)
        return during, realtime.bus.subscriber_count()

    during, after = asyncio.run(scenario())
    assert (during, after) == (1, 0)
