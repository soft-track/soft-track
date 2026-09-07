"""A small in-process throttle, used to slow down credential guessing.

Scope, stated up front: the counters live in this process's memory. One
container running one worker -- what `docker compose up` gives you -- is
exactly covered. Run several workers or replicas and each keeps its own
counters, so the effective budget multiplies by the number of processes.
That is still far better than the unlimited attempts we had, and it needs no
Redis to deploy. When SoftTrack grows a shared cache, `Throttle` is the one
class to reimplement against it; nothing else has to change.
"""

import threading
from dataclasses import dataclass, field
from math import ceil
from typing import Callable

from fastapi import HTTPException, Request, status

# Sweeping every write would be O(n) on a dict that is usually tiny, so only
# bother once it has grown enough to be worth the walk. This is the bound on
# how much memory a flood of distinct addresses can cost us.
_PRUNE_ABOVE = 10_000


@dataclass
class _Record:
    attempts: int = 0
    last_attempt: float = 0.0
    locked_until: float = 0.0


@dataclass
class Throttle:
    """Counts attempts against a key and locks it out for a growing delay.

    `free_attempts` attempts get through untouched -- people mistype
    passwords. The next one is refused, and every further attempt doubles the
    wait, from `base_delay` up to `max_delay`. A key that goes quiet for
    `forget_after` seconds is forgotten entirely, so an honest user is never
    carrying yesterday's typos.
    """

    name: str
    free_attempts: int
    base_delay: float
    max_delay: float
    forget_after: float
    clock: Callable[[], float] = field(default=None)

    def __post_init__(self) -> None:
        if self.clock is None:
            # Monotonic, not wall time: the lockout has to survive an NTP step
            # or a daylight-saving jump without either expiring early or
            # stranding someone for an hour.
            import time

            self.clock = time.monotonic
        self._lock = threading.Lock()
        self._records: dict[str, _Record] = {}

    def raise_if_locked(self, key: str) -> None:
        """Reject the request with 429 while `key` is serving a lockout."""
        with self._lock:
            record = self._records.get(key)
            if record is None:
                return
            remaining = record.locked_until - self.clock()
            if remaining <= 0:
                return
        retry_after = max(1, ceil(remaining))
        unit = "second" if retry_after == 1 else "seconds"
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many {self.name}. Try again in {retry_after} {unit}.",
            headers={"Retry-After": str(retry_after)},
        )

    def record_attempt(self, key: str) -> None:
        """Spend one attempt from `key`'s budget, extending the lockout."""
        now = self.clock()
        with self._lock:
            record = self._records.get(key)
            if record is None or self._is_expired(record, now):
                record = _Record()
                self._records[key] = record

            record.attempts += 1
            record.last_attempt = now

            # The lockout starts once the budget is spent, so the attempt
            # after the last free one is the first to be refused.
            over = record.attempts - self.free_attempts
            if over >= 0:
                delay = min(self.base_delay * 2**over, self.max_delay)
                record.locked_until = now + delay

            if len(self._records) > _PRUNE_ABOVE:
                self._prune(now)

    def forgive(self, key: str) -> None:
        """Clear `key`'s record. Called when the attempt succeeded."""
        with self._lock:
            self._records.pop(key, None)

    def reset(self) -> None:
        with self._lock:
            self._records.clear()

    def _is_expired(self, record: _Record, now: float) -> bool:
        # Never forget a key that is still locked out, however long the
        # lockout ran -- otherwise a long enough backoff would erase itself.
        return (
            now > record.last_attempt + self.forget_after and now > record.locked_until
        )

    def _prune(self, now: float) -> None:
        for key in [k for k, r in self._records.items() if self._is_expired(r, now)]:
            del self._records[key]


# Per address, login. Generous, because a whole office can share one address
# through NAT and one person's bad afternoon should not lock out the floor.
login_by_address = Throttle(
    name="failed sign-in attempts from this address",
    free_attempts=10,
    base_delay=1.0,
    max_delay=15 * 60.0,
    forget_after=15 * 60.0,
)

# Per account, login. This one catches a password spray spread across many
# addresses, which the limiter above cannot see.
#
# The short cap is deliberate. A per-account lockout is itself an attack: if
# it grew without bound, anyone who knows your address could lock you out of
# your own account by failing five sign-ins. Capping the delay at a minute
# still costs an attacker everything -- roughly one guess a minute against a
# given account -- while the worst a griefer can do to you is make you wait.
login_by_account = Throttle(
    name="failed sign-in attempts for this account",
    free_attempts=5,
    base_delay=1.0,
    max_delay=60.0,
    forget_after=15 * 60.0,
)

# Per address, registration. Every attempt counts here, successes included:
# the thing being limited is bulk signup and address enumeration through the
# "Email already registered" response, and both look like success.
registration_by_address = Throttle(
    name="registrations from this address",
    free_attempts=10,
    base_delay=15.0,
    max_delay=60 * 60.0,
    forget_after=60 * 60.0,
)

_ALL = (login_by_address, login_by_account, registration_by_address)


def reset_all() -> None:
    """Drop every counter. For tests, which must not inherit each other's."""
    for throttle in _ALL:
        throttle.reset()


def address_of(request: Request) -> str:
    """The client address to charge this request to.

    Deliberately `request.client`, never the `X-Forwarded-For` header: any
    client can send that header, so trusting it here would let an attacker
    pick a fresh identity per request and walk straight past the limiter.

    Behind a real proxy, `request.client` is the proxy and every user shares
    one bucket. The fix belongs in the deployment, not here -- run uvicorn
    with `--proxy-headers --forwarded-allow-ips=<your proxy>` and Starlette
    rewrites `request.client` from the header it can now trust.
    """
    return request.client.host if request.client else "unknown"
