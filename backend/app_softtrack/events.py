import json

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack import realtime
from lib_softtrack.tables import User
from lib_softtrack.teams import get_team_or_404, require_team_member
from web import get_session

router = APIRouter(tags=["realtime"])

#: A comment line this often keeps proxies from closing an idle stream -- most
#: give up somewhere between 30 and 60 seconds of silence.
HEARTBEAT_SECONDS = 25.0

#: How long a client should wait before reconnecting, sent as the stream's
#: `retry:` field. The browser client reads it too.
RETRY_MS = 5000


@router.get(
    "/teams/{team_id}/events",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def team_events(
    team_id: int,
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """A server-sent event stream of what changes on the team (#103).

    Events are invalidations -- `issue_changed {"id"}`, `comment_added
    {"issue_id"}`, `notification {}` for the caller's own inbox, and `resync`
    when the stream fell behind -- and never data: the client refetches
    through the ordinary endpoints. `close` means the stream is over and must
    not be reopened as it was: the caller was signed out, deactivated or
    removed from the team. A `: ping` comment every 25 seconds keeps proxies
    from dropping it.

    Authenticated with the usual bearer header, which is why the browser
    reads this with `fetch` rather than `EventSource`: EventSource cannot send
    one, and a token in the URL is exactly what this API refuses to do.
    """
    await run_in_threadpool(get_team_or_404, team_id, session)
    await run_in_threadpool(require_team_member, team_id, current_user, session)
    user_id = current_user.id
    # The stream can stay open for hours; the check above is the last thing it
    # needs the database for, so the connection goes back to the pool now
    # rather than being held until the tab closes.
    await run_in_threadpool(session.close)

    subscription = realtime.bus.subscribe(
        [realtime.team_channel(team_id), realtime.user_channel(user_id)]
    )

    async def stream():
        try:
            yield f"retry: {RETRY_MS}\n: connected\n\n"
            while True:
                event = await subscription.next(HEARTBEAT_SECONDS)
                if event is None:
                    yield ": ping\n\n"
                    continue
                if event.name == "close":
                    about = json.loads(event.body).get("team_id")
                    if about not in (None, team_id):
                        continue  # left some other team; this one is fine
                    yield event.encode()
                    return
                yield event.encode()
        finally:
            subscription.close()

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            # nginx buffers responses by default, which holds every event back
            # until a buffer fills -- i.e. forever. This turns that off for
            # this response without touching the proxy's config.
            "X-Accel-Buffering": "no",
        },
    )
