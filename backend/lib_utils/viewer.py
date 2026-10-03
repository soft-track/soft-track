"""Who is asking, for the one thing a response model cannot know itself (#317).

Somebody from outside the organisation sees a person by name and never by
address. People reach the API in a hundred places -- a ticket's assignee, a
comment's author, a roster, a notification's actor -- all of them as
`UserPublic`, so that one model leaves the address out when the caller is
from outside, and nothing else has to remember to.

A response model is built far from the request that asked for it, so the
caller is kept here: `ViewerScope` gives each request a holder, and the
request fills it in once it knows who is signed in (`lib_softtrack/outside.py`
`confine`). A holder rather than a value, because the dependency that learns
who is asking runs in a worker thread with a copy of the request's context:
what it sets is lost, and what it changes inside the holder is not.
"""

from contextvars import ContextVar
from typing import Optional

_viewer: ContextVar[Optional[dict]] = ContextVar("softtrack_viewer", default=None)


def outside_viewer() -> Optional[int]:
    """The id of the account from outside that is asking, if one is."""
    holder = _viewer.get()
    return holder.get("outside") if holder is not None else None


def set_outside_viewer(user_id: Optional[int]) -> None:
    """Record who is asking: an account from outside, or (None) anybody else."""
    holder = _viewer.get()
    if holder is not None:
        holder["outside"] = user_id


class ViewerScope:
    """ASGI middleware: a fresh holder for every request."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        token = _viewer.set({})
        try:
            await self.app(scope, receive, send)
        finally:
            _viewer.reset(token)
