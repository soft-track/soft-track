"""Outbound webhooks (#91): posting a team's events to URLs it chooses.

The shape is an outbox. `emit` writes one WebhookDelivery row per interested
webhook, in the same transaction as the change it reports; `deliver_due`
sends them later, from `webhook_loop`, off any request. So a slow or dead
receiver never slows the tracker, an event is never lost between a change
committing and its send, and a retry is simply the same row sent again.

Each delivery is a JSON POST signed like the GitHub deliveries SoftTrack
verifies: `X-SoftTrack-Signature: sha256=<hex HMAC-SHA256 of the raw body>`,
keyed with the webhook's secret. `X-SoftTrack-Event` names the event and
`X-SoftTrack-Delivery` the delivery, for deduplicating.

A delivery gets MAX_ATTEMPTS tries with growing gaps. One that fails every
try counts against its webhook, and DISABLE_AFTER of those in a row switch
the webhook off, visibly, until an admin turns it back on.

A webhook URL is server-side request forgery surface: whoever sets it chooses
where this server sends requests. `check_target` refuses private, loopback,
link-local and otherwise non-public addresses -- when the URL is saved, and
again before every send, since DNS can change in between -- and redirects are
never followed. WEBHOOK_ALLOW_PRIVATE_TARGETS lifts the check for an instance
that genuinely posts to its own network.
"""

import asyncio
import hashlib
import hmac
import ipaddress
import json
import logging
import secrets
import socket
from datetime import date, datetime, timedelta
from typing import Callable, Iterable, Optional
from urllib.parse import urlsplit

from fastapi.encoders import jsonable_encoder
from sqlalchemy import delete, or_, update
from sqlmodel import Session, select

from lib_softtrack.tables import (
    OutboundWebhook,
    Team,
    User,
    WebhookDelivery,
    WebhookEvent,
    WorkflowStatus,
    utcnow,
)
from lib_softtrack.models.outbound import (
    OutboundWebhookCreate,
    OutboundWebhookCreated,
    OutboundWebhookRead,
    OutboundWebhookUpdate,
    WebhookDeliveryRead,
)
from lib_utils.errors import ErrorCode, api_error

logger = logging.getLogger(__name__)

#: Tries per delivery, and the wait before each retry. The first try is
#: immediate; the last retry comes about half an hour after the event.
MAX_ATTEMPTS = 4
BACKOFF = (timedelta(seconds=30), timedelta(minutes=5), timedelta(minutes=30))
#: Deliveries in a row that fail every try before the webhook is switched off.
DISABLE_AFTER = 5
#: How long one attempt may take.
TIMEOUT_SECONDS = 10
#: Deliveries kept per webhook for the log; older ones are pruned.
KEEP_DELIVERIES = 50
#: How much of a response body is kept, for reading in the UI.
EXCERPT_CHARS = 500
#: How long a worker holds a claimed delivery before another may take it.
CLAIM_FOR = timedelta(minutes=2)

SIGNATURE_HEADER = "X-SoftTrack-Signature"


# --- configuration ------------------------------------------------------------


def parse_events(stored: str) -> list[WebhookEvent]:
    return [WebhookEvent(value) for value in stored.split(",") if value]


def store_events(events: Iterable[WebhookEvent]) -> str:
    return ",".join(sorted({event.value for event in events}))


def new_secret() -> str:
    return "whsec_" + secrets.token_urlsafe(32)


def _is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def check_target(url: str, resolve: Optional[Callable] = None) -> None:
    """Refuse a URL this server should not send to.

    Every address the host resolves to must be public -- one private answer
    is enough to refuse, since which one a connection uses is not ours to
    pick. An IP literal is checked as it is.
    """
    from web import settings

    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise api_error(
            status_code=422,
            code=ErrorCode.webhook_invalid,
            detail="A webhook URL must be an http:// or https:// address.",
        )
    if settings.webhook_allow_private_targets:
        return
    host = parts.hostname
    # Looked up at call time rather than bound as a default, so it is the
    # resolver in force now -- which is also what lets a test replace it.
    resolve = resolve or socket.getaddrinfo
    try:
        addresses = (
            {host}
            if _looks_like_ip(host)
            else {
                info[4][0]
                for info in resolve(host, parts.port or 443, proto=socket.IPPROTO_TCP)
            }
        )
    except (socket.gaierror, UnicodeError):
        raise api_error(
            status_code=422,
            code=ErrorCode.webhook_invalid,
            detail=f"Could not resolve {host}.",
        )
    if not addresses or not all(_is_public(address) for address in addresses):
        raise api_error(
            status_code=422,
            code=ErrorCode.webhook_target_private,
            detail=(
                f"{host} is a private, loopback or link-local address. Webhooks "
                "go to public addresses unless WEBHOOK_ALLOW_PRIVATE_TARGETS is set."
            ),
        )


def _looks_like_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


# --- emitting ---------------------------------------------------------------------


def _json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    raise TypeError(f"{type(value).__name__} is not JSON serialisable")


def emit(
    session: Session,
    team_id: int,
    event: WebhookEvent,
    data: Callable[[], dict],
    actor: Optional[User],
    only_webhook_id: Optional[int] = None,
) -> int:
    """Queue `event` for every enabled webhook on the team that wants it.

    `data` is a callable, built only if somebody is listening: most teams have
    no webhooks, and building an issue's full read for nobody is a waste of
    queries on every change. Nothing is committed here -- the rows join the
    caller's transaction, which is what makes this an outbox. Returns how many
    deliveries were queued.
    """
    query = select(OutboundWebhook).where(
        OutboundWebhook.team_id == team_id,
        OutboundWebhook.is_enabled == True,  # noqa: E712
    )
    if only_webhook_id is not None:
        query = query.where(OutboundWebhook.id == only_webhook_id)
    listeners = [
        hook
        for hook in session.exec(query).all()
        if event == WebhookEvent.ping or event in parse_events(hook.events)
    ]
    if not listeners:
        return 0

    team = session.get(Team, team_id)
    now = utcnow()
    body = json.dumps(
        {
            "event": event.value,
            "occurred_at": now,
            "team": {"id": team.id, "key": team.key, "name": team.name},
            "actor": (
                {"id": actor.id, "username": actor.username, "name": actor.full_name}
                if actor
                else None
            ),
            "data": jsonable_encoder(data()),
        },
        default=_json_default,
        separators=(",", ":"),
    )
    for hook in listeners:
        session.add(
            WebhookDelivery(
                webhook_id=hook.id,
                event=event.value,
                payload=body,
                next_attempt_at=now,
            )
        )
    return len(listeners)


#: The issue fields an `issue.updated` reports changes to.
_ISSUE_FIELDS = (
    "title",
    "description",
    "status_id",
    "priority",
    "type",
    "assignee_id",
    "estimate",
    "cycle_id",
    "project_id",
    "parent_id",
    "due_date",
)


def snapshot(issue) -> dict:
    """The fields `issue_changed` compares, taken before an update."""
    return {field: getattr(issue, field) for field in _ISSUE_FIELDS}


def _plain(value):
    return getattr(value, "value", value)


def issue_changed(session: Session, issue, before: dict, actor: Optional[User]) -> None:
    """Emit `issue.updated` (and `issue.status_changed`) for what moved."""
    changes = {
        field: {"from": _plain(before[field]), "to": _plain(getattr(issue, field))}
        for field in _ISSUE_FIELDS
        if before[field] != getattr(issue, field)
    }
    if not changes:
        return

    from lib_softtrack.issues import issue_to_read

    read = lambda: issue_to_read(issue, session)  # noqa: E731
    emit(
        session,
        issue.team_id,
        WebhookEvent.issue_updated,
        lambda: {"issue": read(), "changes": changes},
        actor,
    )
    if "status_id" in changes:
        old = session.get(WorkflowStatus, before["status_id"])
        new = session.get(WorkflowStatus, issue.status_id)
        emit(
            session,
            issue.team_id,
            WebhookEvent.issue_status_changed,
            lambda: {
                "issue": read(),
                "from": (
                    {"id": old.id, "name": old.name, "category": old.category}
                    if old
                    else None
                ),
                "to": {"id": new.id, "name": new.name, "category": new.category},
            },
            actor,
        )


# --- delivering -------------------------------------------------------------------


Sender = Callable[[str, dict, bytes], tuple[int, str]]


def http_sender(url: str, headers: dict, body: bytes) -> tuple[int, str]:
    """POST it. Redirects are not followed: a 3xx to an internal address is
    exactly how a forgery would get past `check_target`."""
    import httpx

    response = httpx.post(
        url,
        content=body,
        headers=headers,
        timeout=TIMEOUT_SECONDS,
        follow_redirects=False,
    )
    return response.status_code, response.text


def sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _claim(session: Session, ids: list[int], now: datetime) -> list[int]:
    """Take the rows no other worker holds, and say which were taken."""
    claimed = session.exec(
        update(WebhookDelivery)
        .where(
            WebhookDelivery.id.in_(ids),
            or_(
                WebhookDelivery.claimed_until == None,  # noqa: E711
                WebhookDelivery.claimed_until < now,
            ),
        )
        .values(claimed_until=now + CLAIM_FOR)
        .returning(WebhookDelivery.id)
        # The database decides the claim; replaying the WHERE in Python against
        # rows already loaded would compare SQLite's naive datetimes with an
        # aware one, and says nothing the RETURNING does not.
        .execution_options(synchronize_session=False)
    ).all()
    session.commit()
    return [row[0] for row in claimed]


def deliver_due(
    session: Session,
    sender: Sender = http_sender,
    now: Optional[datetime] = None,
    resolve: Optional[Callable] = None,
    batch: int = 25,
) -> int:
    """Send every delivery that is due. Returns how many were attempted."""
    now = now or utcnow()
    due = session.exec(
        select(WebhookDelivery.id)
        .where(
            WebhookDelivery.status == "pending",
            WebhookDelivery.next_attempt_at <= now,
        )
        .order_by(WebhookDelivery.id)
        .limit(batch)
    ).all()
    attempted = 0
    for delivery_id in _claim(session, list(due), now):
        delivery = session.get(WebhookDelivery, delivery_id)
        hook = session.get(OutboundWebhook, delivery.webhook_id)
        if hook is None or not hook.is_enabled:
            delivery.status = "failed"
            delivery.next_attempt_at = None
            delivery.response_excerpt = (
                "The webhook was switched off before this was sent."
            )
            delivery.completed_at = now
            session.add(delivery)
            session.commit()
            continue
        _attempt(session, hook, delivery, sender, now, resolve)
        attempted += 1
    return attempted


def _attempt(session, hook, delivery, sender, now, resolve) -> None:
    body = delivery.payload.encode()
    delivery.attempts += 1
    ok = False
    try:
        check_target(hook.url, resolve)
        status_code, text = sender(
            hook.url,
            {
                "Content-Type": "application/json",
                "User-Agent": "SoftTrack-Webhooks",
                "X-SoftTrack-Event": delivery.event,
                "X-SoftTrack-Delivery": str(delivery.id),
                SIGNATURE_HEADER: sign(hook.secret, body),
            },
            body,
        )
        delivery.response_status = status_code
        delivery.response_excerpt = (text or "")[:EXCERPT_CHARS]
        ok = 200 <= status_code < 300
    except Exception as exc:  # noqa: BLE001 -- any failure is a failed try
        delivery.response_status = None
        detail = getattr(exc, "detail", None) or f"{type(exc).__name__}: {exc}"
        delivery.response_excerpt = str(detail)[:EXCERPT_CHARS]

    delivery.claimed_until = None
    if ok:
        delivery.status = "succeeded"
        delivery.next_attempt_at = None
        delivery.completed_at = now
        hook.consecutive_failures = 0
    elif delivery.attempts < MAX_ATTEMPTS:
        delivery.next_attempt_at = now + BACKOFF[delivery.attempts - 1]
    else:
        delivery.status = "failed"
        delivery.next_attempt_at = None
        delivery.completed_at = now
        hook.consecutive_failures += 1
        if hook.consecutive_failures >= DISABLE_AFTER:
            hook.is_enabled = False
            hook.disabled_reason = (
                f"Switched off after {DISABLE_AFTER} deliveries in a row failed "
                "every retry."
            )
    session.add(delivery)
    session.add(hook)
    session.commit()
    _prune(session, hook.id)


def _prune(session: Session, webhook_id: int) -> None:
    keep = session.exec(
        select(WebhookDelivery.id)
        .where(WebhookDelivery.webhook_id == webhook_id)
        .order_by(WebhookDelivery.id.desc())
        .limit(KEEP_DELIVERIES)
    ).all()
    if len(keep) < KEEP_DELIVERIES:
        return
    session.execute(
        delete(WebhookDelivery).where(
            WebhookDelivery.webhook_id == webhook_id,
            WebhookDelivery.id < min(keep),
            WebhookDelivery.status != "pending",
        )
    )
    session.commit()


async def webhook_loop(interval_seconds: float = 2.0) -> None:
    """Send due deliveries every couple of seconds, forever.

    In-process, like the digest loop, because the promise is `docker compose
    up`. The claim in `_claim` keeps it safe when the process is replicated.
    HTTP blocks, so each tick runs in a worker thread.
    """
    from web import engine

    def tick() -> None:
        with Session(engine) as session:
            deliver_due(session)

    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await asyncio.to_thread(tick)
        except Exception:
            logger.exception("The webhook delivery tick failed")


# --- managing webhooks ------------------------------------------------------------


def _hook_or_404(
    session: Session, current_user: User, webhook_id: int
) -> OutboundWebhook:
    from lib_softtrack.teams import require_team_admin

    hook = session.get(OutboundWebhook, webhook_id)
    if hook is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.webhook_not_found,
            detail="Webhook not found",
        )
    require_team_admin(hook.team_id, current_user, session)
    return hook


def _require_events(events) -> None:
    if not events:
        raise api_error(
            status_code=422,
            code=ErrorCode.webhook_invalid,
            detail="Choose at least one event to send.",
        )


def to_read(hook: OutboundWebhook) -> OutboundWebhookRead:
    return OutboundWebhookRead(
        id=hook.id,
        team_id=hook.team_id,
        url=hook.url,
        events=parse_events(hook.events),
        is_enabled=hook.is_enabled,
        consecutive_failures=hook.consecutive_failures,
        disabled_reason=hook.disabled_reason,
        secret_hint="whsec_…" + hook.secret[-4:],
        created_at=hook.created_at,
    )


def list_webhooks(session: Session, current_user: User, team_id: int):
    from lib_softtrack.teams import get_team_or_404, require_team_admin

    get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)
    hooks = session.exec(
        select(OutboundWebhook)
        .where(OutboundWebhook.team_id == team_id)
        .order_by(OutboundWebhook.id)
    ).all()
    return [to_read(hook) for hook in hooks]


def create_webhook(
    session: Session, current_user: User, team_id: int, payload: OutboundWebhookCreate
) -> OutboundWebhookCreated:
    from lib_softtrack.teams import get_team_or_404, require_team_admin

    get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)
    _require_events(payload.events)
    check_target(payload.url)
    hook = OutboundWebhook(
        team_id=team_id,
        url=payload.url,
        secret=payload.secret or new_secret(),
        events=store_events(payload.events),
        created_by_id=current_user.id,
    )
    session.add(hook)
    session.commit()
    session.refresh(hook)
    return OutboundWebhookCreated(**to_read(hook).model_dump(), secret=hook.secret)


def update_webhook(
    session: Session,
    current_user: User,
    webhook_id: int,
    payload: OutboundWebhookUpdate,
) -> OutboundWebhookRead:
    hook = _hook_or_404(session, current_user, webhook_id)
    if payload.url is not None:
        check_target(payload.url)
        hook.url = payload.url
    if payload.events is not None:
        _require_events(payload.events)
        hook.events = store_events(payload.events)
    if payload.is_enabled is not None:
        if payload.is_enabled and not hook.is_enabled:
            # A fresh start: whatever tripped the automatic switch-off is
            # presumably fixed, and the old count would trip it again at once.
            hook.consecutive_failures = 0
            hook.disabled_reason = None
        hook.is_enabled = payload.is_enabled
    session.add(hook)
    session.commit()
    session.refresh(hook)
    return to_read(hook)


def delete_webhook(session: Session, current_user: User, webhook_id: int) -> None:
    hook = _hook_or_404(session, current_user, webhook_id)
    session.execute(
        delete(WebhookDelivery).where(WebhookDelivery.webhook_id == hook.id)
    )
    session.delete(hook)
    session.commit()


def list_deliveries(session: Session, current_user: User, webhook_id: int):
    hook = _hook_or_404(session, current_user, webhook_id)
    rows = session.exec(
        select(WebhookDelivery)
        .where(WebhookDelivery.webhook_id == hook.id)
        .order_by(WebhookDelivery.id.desc())
        .limit(KEEP_DELIVERIES)
    ).all()
    return [
        WebhookDeliveryRead.model_validate(row, from_attributes=True) for row in rows
    ]


def ping(session: Session, current_user: User, webhook_id: int) -> None:
    """Queue a `ping` to one webhook, to check its URL and secret work."""
    hook = _hook_or_404(session, current_user, webhook_id)
    if not hook.is_enabled:
        raise api_error(
            status_code=409,
            code=ErrorCode.webhook_invalid,
            detail="Turn the webhook on before sending it a ping.",
        )
    emit(
        session,
        hook.team_id,
        WebhookEvent.ping,
        lambda: {"webhook_id": hook.id, "message": "Hello from SoftTrack."},
        current_user,
        only_webhook_id=hook.id,
    )
    session.commit()
