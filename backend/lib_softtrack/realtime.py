"""Real-time invalidation events over server-sent events (#103).

What gets sent is a nudge, not data: `issue_changed {"id": 42}`,
`comment_added {"issue_id": 42}`, `notification {}`. The browser answers a
nudge by refetching through the same REST endpoints it already uses, so there
is one way data reaches the page, one set of permission checks, and nothing
here that can drift from what the API would have returned.

**Where events come from: the ORM, not the services.** A session listener
watches what each flush writes -- issues, comments, reactions, links, time
entries, notifications -- and publishes once the transaction commits. One
place rather than a publish call in every service, so an issue moved by an
automation rule, a webhook from GitHub or a Jira import is announced exactly
like one dragged on the board, and a code path added next year is announced
without anyone remembering to. Publishing waits for the commit: a nudge sent
before it would have the browser refetch the old row, and one for a
transaction that rolled back would announce something that never happened.

**Where events go: an in-process bus.** Subscribers are the open streams of
this process. That is the whole story for the default deployment -- one
uvicorn worker -- and the limit of this version: with several workers, a
change handled by one reaches only the streams open on that one. `EventBus`
is the seam for the designed follow-up, Postgres LISTEN/NOTIFY, which would
publish to the database and have every worker's bus deliver locally.
"""

import asyncio
import json
import logging
import threading
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional, Protocol

from sqlalchemy import event, inspect
from sqlmodel import Session

from lib_softtrack.tables import (
    Attachment,
    Comment,
    CommentReaction,
    Issue,
    IssueLabelLink,
    IssueLink,
    Notification,
    TeamMember,
    User,
    Worklog,
)

logger = logging.getLogger(__name__)

#: How many undelivered events one stream may hold before it is told to
#: refetch everything instead. A stream this far behind is a tab that stopped
#: reading; catching it up event by event would be slower than starting over.
QUEUE_LIMIT = 256


@dataclass(frozen=True)
class Event:
    """One nudge: its name and a small JSON body of ids.

    The body is kept as its JSON text so an event is hashable, which is what
    lets one transaction that touches an issue five times announce it once.
    """

    name: str
    body: str = "{}"

    @classmethod
    def of(cls, name: str, **data: object) -> "Event":
        return cls(name, json.dumps(data, sort_keys=True))

    def encode(self) -> str:
        return f"event: {self.name}\ndata: {self.body}\n\n"


#: Sent to a stream that fell behind: throw away what you have and refetch.
RESYNC = Event("resync")
#: Sent on the user channel when a stream must end -- signed out everywhere,
#: deactivated, or removed from the team the stream is about.
CLOSE = Event("close")


class EventBus(Protocol):
    """Where events are published and subscribed. See the module docstring."""

    def publish(self, channel: str, event: Event) -> None: ...

    def subscribe(self, channels: list[str]) -> "Subscription": ...


class Subscription:
    """One open stream's queue, fed from any thread, read on the event loop."""

    def __init__(self, bus: "InProcessBus", channels: list[str]):
        self._bus = bus
        self.channels = channels
        self.loop = asyncio.get_running_loop()
        self.queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=QUEUE_LIMIT)

    def deliver(self, event: Event) -> None:
        """Called on the loop's thread. Never blocks, never raises."""
        try:
            self.queue.put_nowait(event)
        except asyncio.QueueFull:
            # Drop the backlog and ask for a clean refetch instead: one
            # resync is worth more than the 256 nudges it replaces.
            while not self.queue.empty():
                self.queue.get_nowait()
            self.queue.put_nowait(RESYNC)

    async def next(self, timeout: float) -> Optional[Event]:
        """The next event, or None after `timeout` seconds of quiet."""
        try:
            return await asyncio.wait_for(self.queue.get(), timeout)
        except asyncio.TimeoutError:
            return None

    def close(self) -> None:
        self._bus._remove(self)


class InProcessBus:
    """Fan-out to the streams open in this process."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: dict[str, set[Subscription]] = defaultdict(set)

    def subscribe(self, channels: list[str]) -> Subscription:
        subscription = Subscription(self, channels)
        with self._lock:
            for channel in channels:
                self._subscribers[channel].add(subscription)
        return subscription

    def _remove(self, subscription: Subscription) -> None:
        with self._lock:
            for channel in subscription.channels:
                self._subscribers[channel].discard(subscription)
                if not self._subscribers[channel]:
                    del self._subscribers[channel]

    def publish(self, channel: str, event: Event) -> None:
        """Safe from any thread: sync route handlers run in a threadpool."""
        with self._lock:
            targets = list(self._subscribers.get(channel, ()))
        for subscription in targets:
            try:
                subscription.loop.call_soon_threadsafe(subscription.deliver, event)
            except RuntimeError:
                # The loop has closed under a stream that never got to
                # unsubscribe -- shutdown. Nothing is listening any more.
                pass

    def subscriber_count(self) -> int:
        with self._lock:
            return len({s for subs in self._subscribers.values() for s in subs})


bus: EventBus = InProcessBus()


def team_channel(team_id: int) -> str:
    return f"team:{team_id}"


def user_channel(user_id: int) -> str:
    return f"user:{user_id}"


# --- turning writes into events ---------------------------------------------

_PENDING = "realtime_pending"


def _pending(session: Session) -> set[tuple[str, Event]]:
    return session.info.setdefault(_PENDING, set())


def _issue_team(session: Session, issue_id: int) -> Optional[int]:
    issue = session.get(Issue, issue_id)
    return issue.team_id if issue is not None else None


def _collect(session: Session, flush_context) -> None:
    """Note what this flush wrote. Nothing is sent until the commit.

    Runs inside the flush, so every lookup here is made without autoflush --
    one would start a second flush inside the first.
    """
    with session.no_autoflush:
        _collect_from(session, _pending(session))


def _collect_from(session: Session, pending: set[tuple[str, Event]]) -> None:
    def issue_changed(team_id: Optional[int], issue_id: int) -> None:
        if team_id is not None:
            pending.add((team_channel(team_id), Event.of("issue_changed", id=issue_id)))

    for obj in list(session.new) + list(session.dirty) + list(session.deleted):
        if isinstance(obj, Issue):
            issue_changed(obj.team_id, obj.id)
            # An issue moving teams (#98) leaves one board as well as joining
            # another, and both boards have to hear about it.
            history = inspect(obj).attrs.team_id.history
            for old_team in history.deleted or ():
                issue_changed(old_team, obj.id)
        elif isinstance(obj, Comment):
            team = _issue_team(session, obj.issue_id)
            if team is not None:
                pending.add(
                    (
                        team_channel(team),
                        Event.of("comment_added", issue_id=obj.issue_id),
                    )
                )
        elif isinstance(obj, CommentReaction):
            comment = session.get(Comment, obj.comment_id)
            if comment is not None:
                team = _issue_team(session, comment.issue_id)
                if team is not None:
                    pending.add(
                        (
                            team_channel(team),
                            Event.of("comment_added", issue_id=comment.issue_id),
                        )
                    )
        elif isinstance(obj, (Worklog, Attachment, IssueLabelLink)):
            # Rows that change what an issue shows without touching the
            # issue row: its time, its files, its labels.
            issue_changed(_issue_team(session, obj.issue_id), obj.issue_id)
        elif isinstance(obj, IssueLink):
            for issue_id in (obj.source_id, obj.target_id):
                issue_changed(_issue_team(session, issue_id), issue_id)
        elif isinstance(obj, Notification) and obj in session.new:
            pending.add((user_channel(obj.user_id), Event.of("notification")))
        elif isinstance(obj, TeamMember) and obj in session.deleted:
            # Removed, or left: the stream about that team ends.
            pending.add(
                (user_channel(obj.user_id), Event.of("close", team_id=obj.team_id))
            )
        elif isinstance(obj, User) and obj in session.dirty:
            state = inspect(obj).attrs
            signed_out = state.token_version.history.has_changes()
            deactivated = state.is_active.history.has_changes() and not obj.is_active
            if signed_out or deactivated:
                pending.add((user_channel(obj.id), CLOSE))


def _publish(session: Session) -> None:
    pending = session.info.pop(_PENDING, None)
    if not pending:
        return
    for channel, event_ in pending:
        try:
            bus.publish(channel, event_)
        except Exception:  # pragma: no cover -- never let a nudge fail a write
            logger.exception("Could not publish %s to %s", event_.name, channel)


def _discard(session: Session, *_args) -> None:
    session.info.pop(_PENDING, None)


def install() -> None:
    """Listen to every session. Idempotent; called once from main."""
    if event.contains(Session, "after_flush", _collect):
        return
    event.listen(Session, "after_flush", _collect)
    event.listen(Session, "after_commit", _publish)
    event.listen(Session, "after_rollback", _discard)
    event.listen(Session, "after_soft_rollback", _discard)
