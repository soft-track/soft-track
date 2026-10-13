"""Who can see money at all (#130).

SoftTrack's other roles say nothing about money. A team admin runs a team;
the site admin resets passwords and deactivates accounts, which is an IT
role, and nothing about it should imply reading salaries. So money has a
flag of its own, `User.is_finance_admin`, granted and revoked by a site admin
and separate from being one: neither includes the other.

The visibility is the inverse of the people directory's. Who works here is
readable by everyone signed in; what they are paid is readable by almost
nobody. One flag, all or nothing -- no view/edit/approve split and no
per-department scoping, the same way team roles stayed two until something
earned a third.

Every finance endpoint sits on a router from `finance_router()`, which puts
`require_finance_admin` in front of all of its routes at once, and
`tests/test_finance_access.py` fails if a route under /finance is missing it.
There is no last-finance-admin rule: if the last one leaves, a site admin
grants the flag again. The last-site-admin rule exists only because nobody
would be left to do the granting.
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends

from lib_identity.identity import get_current_user
from lib_softtrack.tables import User, utcnow
from lib_utils.errors import ErrorCode, api_error

# "uvicorn.error" for the reason main.py gives: uvicorn configures its own
# loggers and leaves the root alone, so an INFO line from a module logger is
# swallowed. Money access changing hands silently is how audits go wrong --
# this line has to actually appear.
logger = logging.getLogger("uvicorn.error")


def require_finance_admin(current_user: User = Depends(get_current_user)) -> User:
    """The one check in front of every finance endpoint."""
    if not current_user.is_finance_admin:
        raise api_error(
            status_code=403,
            code=ErrorCode.not_finance_admin,
            detail="Only finance admins can do that",
        )
    return current_user


def finance_router(**kwargs: Any) -> APIRouter:
    """An APIRouter that refuses anybody without finance access.

    The dependency is the router's, so a route added to it later is guarded
    whether or not its author remembered to ask. A route that needs the
    caller asks for `require_finance_admin` as well, and FastAPI runs it once.
    """
    return APIRouter(dependencies=[Depends(require_finance_admin)], **kwargs)


def set_finance_admin(actor: User, user: User, granted: bool) -> None:
    """Grant or revoke finance access, and write the log line that says so.

    Who, whom and when, in a line that reads the same in any log collector:

        finance_admin.granted at=2026-09-27T10:14:03Z by=sofia user=mei

    Does not commit; the caller saves it with whatever else changed. Asking
    for what they already have changes nothing and logs nothing, so the grant
    date stays the day access was actually given.
    """
    if user.is_finance_admin == granted:
        return
    now = utcnow()
    user.is_finance_admin = granted
    user.finance_admin_since = now if granted else None
    user.finance_admin_granted_by_id = actor.id if granted else None
    logger.info(
        "finance_admin.%s at=%s by=%s user=%s",
        "granted" if granted else "revoked",
        now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        actor.username,
        user.username,
    )
