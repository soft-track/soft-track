"""The two unauthenticated routes in SoftTrack, and why they are safe.

Every other endpoint is behind `get_current_user`. These cannot be: the caller
is GitHub or GitLab, which has no account here and never will. What stands in
for a bearer token is a pair -- an unguessable token in the path saying *which*
connection this is for, and a signature over the body proving the delivery came
from somebody holding that connection's secret. Neither alone is enough, which
is what makes a leaked webhook URL survivable.

The failure path gets as much care as the success path, because the provider's
delivery log is the only debugging surface the person setting this up has. A
bare 500 there reads as "SoftTrack is broken"; "This webhook is connected to
acme/api, but the delivery is about acme/www" reads as the mistake it is.
"""

from fastapi import APIRouter, Depends, Request, Response
from sqlmodel import Session

from lib_softtrack import integrations as integrations_service
from lib_softtrack.models.integrations import WebhookReceipt
from lib_softtrack.tables import GitProvider
from lib_softtrack.webhooks import WebhookError
from lib_utils.rate_limit import address_of, webhook_by_address
from web import get_session

router = APIRouter(tags=["webhooks"])


async def _receive(
    request: Request,
    response: Response,
    provider: GitProvider,
    hook_token: str,
    event_name: str,
    session: Session,
) -> WebhookReceipt:
    """Shared body for both providers. Only the header names differ."""
    address = address_of(request)
    # Only *failed* verifications are counted, and a good one forgives the
    # address -- the same arrangement as the sign-in throttle. Charging every
    # delivery would throttle a busy repository for being busy, which is the
    # opposite of what this is for.
    webhook_by_address.raise_if_locked(address)

    body = await request.body()
    headers = {name.lower(): value for name, value in request.headers.items()}

    try:
        receipt = integrations_service.receive(
            session, provider, hook_token, event_name, body, headers
        )
    except WebhookError as error:
        webhook_by_address.record_attempt(address)
        # Returned rather than raised as an HTTPException so the provider gets
        # the reason in a shape it will render, and so a bad delivery is never
        # an exception in the logs -- these arrive from the internet, and a
        # stack trace per forged request is a way to fill a disk.
        response.status_code = error.status
        return WebhookReceipt(events=0, links=0, issues=[error.detail])

    webhook_by_address.forgive(address)
    return receipt


@router.post("/webhooks/github/{hook_token}", response_model=WebhookReceipt)
async def github_webhook(
    hook_token: str,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
):
    """A GitHub delivery: `push` and `pull_request` are acted on, the rest
    accepted and ignored.

    Verified with `X-Hub-Signature-256`, an HMAC-SHA256 of the raw body. The
    body has to be read unparsed for that, which is why this route takes a
    `Request` rather than a typed model -- FastAPI's parsed body is not the
    bytes that were signed.
    """
    return await _receive(
        request,
        response,
        GitProvider.github,
        hook_token,
        request.headers.get("x-github-event", ""),
        session,
    )


@router.post("/webhooks/gitlab/{hook_token}", response_model=WebhookReceipt)
async def gitlab_webhook(
    hook_token: str,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
):
    """A GitLab delivery: `Push Hook` and `Merge Request Hook`.

    Verified with `X-Gitlab-Token`, which is the secret sent back verbatim
    rather than an HMAC. That is weaker than GitHub's scheme -- it is a bearer
    secret on the wire, so it depends entirely on TLS -- and it is what GitLab
    offers, so it is compared in constant time and left at that.
    """
    return await _receive(
        request,
        response,
        GitProvider.gitlab,
        hook_token,
        request.headers.get("x-gitlab-event", ""),
        session,
    )
