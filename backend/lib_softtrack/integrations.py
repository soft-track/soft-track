"""Connecting repositories, and turning what they send into links on issues.

The problem this exists for: nothing connected an issue to the code that
implements it, so the status had to be moved by hand -- twice, once when the
branch went up and once when it merged, on every issue, for ever.

The shape of the answer is deliberately narrow. SoftTrack does not clone, does
not call the provider's API and holds no access token. It is told things, by a
webhook it can verify, and everything it knows comes from those payloads. That
is the whole difference between an integration you set up with a URL and a
shared secret and one that needs an OAuth app and a `repo`-scoped token
against every repository in the org.

Three rules everything here keeps:

**The team is the boundary.** A repository is connected by one team, and text
arriving from it resolves only to that team's issues. See
`identifiers.resolve` -- resolving globally would make every connected
repository a way into every board on the instance.

**A redelivery changes nothing twice.** Webhooks are at-least-once, and both
providers have a "redeliver" button that people press when they are debugging.
So links are upserted on `(repository, kind, external_id, issue)` and the
automation triggers fire on transitions -- a row appearing, a pull request
actually becoming merged -- rather than on a payload arriving.

**Nothing is attributed to a SoftTrack user.** The pusher is a GitHub login,
and the mapping from that to an account here is a guess. See
`CodeLink.author_name`, and the same rule in `rules.py`.
"""

import json
import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack import identifiers, rules as rules_service, webhooks
from lib_softtrack.models.integrations import (
    CodeLinkRead,
    CodeLinks,
    RepositoryCreate,
    RepositoryLinkedItem,
    RepositoryRead,
    WebhookReceipt,
)
from lib_softtrack.tables import (
    AutomationTrigger,
    CodeLink,
    CodeLinkKind,
    GitProvider,
    Issue,
    PullRequestState,
    Repository,
    Team,
    User,
)
from lib_softtrack.teams import (
    get_team_or_404,
    require_team_admin,
    require_team_member,
)
from lib_softtrack.webhooks import CodeEvent, WebhookError
from web import settings

#: How many commits from one push are worth recording against an issue. A
#: branch merged from a fork, or a rebase of a long-lived branch, can carry
#: hundreds -- and an issue page listing three hundred commits is one nobody
#: reads past the first screen. The branch and the pull request are the useful
#: links; the commits are colour.
MAX_COMMITS_PER_DELIVERY = 20


def _new_secret() -> str:
    return secrets.token_urlsafe(32)


def _new_hook_token() -> str:
    return secrets.token_urlsafe(24)


def _webhook_url(repository: Repository) -> str:
    return (
        f"{settings.api_base_url.rstrip('/')}"
        f"/webhooks/{repository.provider.value}/{repository.hook_token}"
    )


def _to_read(repository: Repository, author: User) -> RepositoryRead:
    return RepositoryRead(
        id=repository.id,
        team_id=repository.team_id,
        provider=repository.provider,
        full_name=repository.full_name,
        webhook_url=_webhook_url(repository),
        secret=repository.secret,
        last_delivery_at=repository.last_delivery_at,
        created_by=UserPublic.model_validate(author),
        created_at=repository.created_at,
    )


# ---------------------------------------------------------------------------
# Connecting a repository
# ---------------------------------------------------------------------------


def get_repository_or_404(
    session: Session, current_user: User, repository_id: int
) -> Repository:
    repository = session.get(Repository, repository_id)
    if repository is None:
        raise HTTPException(status_code=404, detail="Repository not found")
    require_team_member(repository.team_id, current_user, session)
    return repository


def list_repositories(
    session: Session, current_user: User, team_id: int
) -> list[RepositoryRead]:
    """The team's connected repositories. Admins only -- the response carries
    the webhook secrets, and a secret every member can read is one that has to
    be rotated when anybody leaves."""
    get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)

    rows = session.exec(
        select(Repository, User)
        .join(User, User.id == Repository.created_by_id)
        .where(Repository.team_id == team_id)
        .order_by(Repository.full_name)
    ).all()
    return [_to_read(repository, author) for repository, author in rows]


def create_repository(
    session: Session, current_user: User, team_id: int, payload: RepositoryCreate
) -> RepositoryRead:
    get_team_or_404(team_id, session)
    require_team_admin(team_id, current_user, session)

    full_name = payload.full_name.strip().strip("/")
    existing = session.exec(
        select(Repository).where(
            Repository.team_id == team_id, Repository.full_name == full_name
        )
    ).first()
    if existing is not None:
        raise HTTPException(
            status_code=400, detail="That repository is already connected to this team"
        )

    repository = Repository(
        team_id=team_id,
        provider=payload.provider,
        full_name=full_name,
        hook_token=_new_hook_token(),
        secret=_new_secret(),
        created_by_id=current_user.id,
    )
    session.add(repository)
    session.commit()
    session.refresh(repository)
    return _to_read(repository, current_user)


def rotate_secret(
    session: Session, current_user: User, repository_id: int
) -> RepositoryRead:
    """A new secret, and a new webhook URL with it.

    Both, rather than only the secret. If only the secret changed, a leaked
    URL would still be a known place to aim forged deliveries at once somebody
    guessed or leaked the new secret separately; rotating the pair means the
    old configuration is dead in one step and there is no half-rotated state
    to reason about. The cost is that the provider's webhook has to be
    repointed, which is the same form the secret is pasted into anyway.
    """
    repository = get_repository_or_404(session, current_user, repository_id)
    require_team_admin(repository.team_id, current_user, session)

    repository.secret = _new_secret()
    repository.hook_token = _new_hook_token()
    # Deliveries under the old secret stop here, so what this field says
    # afterwards is "has the new configuration ever worked" -- which is the
    # question somebody who has just rotated is asking.
    repository.last_delivery_at = None
    session.add(repository)
    session.commit()
    session.refresh(repository)
    return _to_read(repository, session.get(User, repository.created_by_id))


def delete_repository(session: Session, current_user: User, repository_id: int) -> None:
    """Disconnect a repository, and take its links with it.

    The links hold a foreign key here, so they have to go either way. It is
    also the right outcome: a branch shown on an issue is a link somebody is
    meant to be able to click, and one belonging to a repository this team no
    longer has connected is a link into somewhere it cannot see.
    """
    repository = get_repository_or_404(session, current_user, repository_id)
    require_team_admin(repository.team_id, current_user, session)

    for link in session.exec(
        select(CodeLink).where(CodeLink.repository_id == repository_id)
    ).all():
        session.delete(link)
    session.flush()

    session.delete(repository)
    session.commit()


# ---------------------------------------------------------------------------
# Reading the links on an issue
# ---------------------------------------------------------------------------


def _link_to_read(link: CodeLink, repository: Repository) -> CodeLinkRead:
    return CodeLinkRead(
        id=link.id,
        kind=link.kind,
        external_id=link.external_id,
        title=link.title,
        url=link.url,
        state=link.state,
        author_name=link.author_name,
        repository=RepositoryLinkedItem(
            id=repository.id,
            provider=repository.provider,
            full_name=repository.full_name,
        ),
        created_at=link.created_at,
        updated_at=link.updated_at,
    )


def list_code_links(session: Session, current_user: User, issue_id: int) -> CodeLinks:
    """Everything connected to one issue, newest first within each group."""
    from lib_softtrack.issues import get_issue_or_404

    issue = get_issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)

    rows = session.exec(
        select(CodeLink, Repository)
        .join(Repository, Repository.id == CodeLink.repository_id)
        .where(CodeLink.issue_id == issue_id)
        .order_by(CodeLink.id.desc())
    ).all()

    links = CodeLinks()
    for link, repository in rows:
        read = _link_to_read(link, repository)
        if link.kind is CodeLinkKind.branch:
            links.branches.append(read)
        elif link.kind is CodeLinkKind.commit:
            links.commits.append(read)
        else:
            links.pull_requests.append(read)
    return links


def delete_links_for_issue(session: Session, issue_id: int) -> None:
    """Drop the code links for an issue being deleted.

    They hold a foreign key to it. Same call and same reasoning as
    `notifications.delete_for_issue`.
    """
    for link in session.exec(
        select(CodeLink).where(CodeLink.issue_id == issue_id)
    ).all():
        session.delete(link)


# ---------------------------------------------------------------------------
# Receiving a delivery
# ---------------------------------------------------------------------------


def receive(
    session: Session,
    provider: GitProvider,
    hook_token: str,
    event_name: str,
    body: bytes,
    headers: dict[str, str],
) -> WebhookReceipt:
    """Verify one delivery and apply it. Raises `WebhookError` if it cannot.

    The order is the point: find the connection, prove the delivery is
    genuine, and only then read the payload. Parsing before verifying would
    mean an unauthenticated caller could reach the JSON decoder, which is
    exactly one more thing than an unauthenticated caller should be able to
    reach.
    """
    if len(body) > webhooks.MAX_BODY_BYTES:
        raise WebhookError(413, "Payload too large")

    repository = session.exec(
        select(Repository).where(
            Repository.hook_token == hook_token, Repository.provider == provider
        )
    ).first()
    if repository is None:
        # 404 rather than 401: there is nothing here to be unauthorised for,
        # and saying "wrong secret" would confirm the token is a real one.
        raise WebhookError(404, "No such webhook")

    webhooks.verify(provider, repository.secret, body, headers)

    try:
        payload = json.loads(body)
    except ValueError:
        raise WebhookError(400, "Body is not JSON")
    if not isinstance(payload, dict):
        raise WebhookError(400, "Body is not a JSON object")

    sent_name = webhooks.repository_name(provider, payload)
    if sent_name and sent_name.lower() != repository.full_name.lower():
        # The signature proved the delivery came from somebody holding this
        # connection's secret; this proves it is about the repository the
        # connection is for. A webhook pasted onto the wrong repository would
        # otherwise link that project's commits to this team's issues.
        raise WebhookError(
            400,
            f"This webhook is connected to {repository.full_name}, "
            f"but the delivery is about {sent_name}",
        )

    events = webhooks.parse(provider, event_name, payload)

    # Recorded even for a delivery that matches nothing. The question this
    # field answers is "is the webhook working", and a `ping` proves it is.
    repository.last_delivery_at = datetime.now(timezone.utc)
    session.add(repository)

    links = 0
    touched: list[str] = []
    for event in _capped(events):
        for identifier in _apply(session, repository, event):
            links += 1
            if identifier not in touched:
                touched.append(identifier)

    session.commit()
    return WebhookReceipt(events=len(events), links=links, issues=touched)


def _capped(events: list[CodeEvent]) -> list[CodeEvent]:
    """Every branch and pull request, and only the first few commits.

    See MAX_COMMITS_PER_DELIVERY. The cap is on commits alone because they are
    the only kind a single delivery can carry hundreds of.
    """
    kept: list[CodeEvent] = []
    commits = 0
    for event in events:
        if event.kind is CodeLinkKind.commit:
            if commits >= MAX_COMMITS_PER_DELIVERY:
                continue
            commits += 1
        kept.append(event)
    return kept


def _apply(session: Session, repository: Repository, event: CodeEvent) -> list[str]:
    """Link one event to the issues it names, and fire what that sets off.

    Returns the identifiers touched, for the receipt.
    """
    issues = identifiers.resolve(session, repository.team_id, event.text)
    if not issues:
        return []

    team = session.get(Team, repository.team_id)
    touched: list[str] = []

    for issue in issues:
        trigger = _upsert(session, repository, event, issue)
        touched.append(f"{team.key}-{issue.number}")
        if trigger is not None:
            # Flushed first so the link exists before a rule can act on the
            # issue -- a rule that posts a comment saying "a PR is open"
            # should not race the row that says so.
            session.flush()
            rules_service.on_code_event(session, issue, trigger)

    return touched


def _upsert(
    session: Session,
    repository: Repository,
    event: CodeEvent,
    issue: Issue,
) -> Optional[AutomationTrigger]:
    """Create or update the link, and say which trigger this was, if any.

    Triggers fire on *transitions*, never on a delivery arriving: a branch row
    appearing for the first time, a pull request row appearing, a pull request
    becoming merged. That is what makes the "redeliver" button in GitHub's UI
    harmless -- press it ten times and the second through tenth change
    nothing, so no rule runs and no comment is posted ten times.
    """
    existing = session.exec(
        select(CodeLink).where(
            CodeLink.repository_id == repository.id,
            CodeLink.kind == event.kind,
            CodeLink.external_id == event.external_id,
            CodeLink.issue_id == issue.id,
        )
    ).first()

    if existing is None:
        session.add(
            CodeLink(
                issue_id=issue.id,
                repository_id=repository.id,
                kind=event.kind,
                external_id=event.external_id,
                title=event.title,
                url=event.url,
                state=event.state,
                author_name=event.author_name,
            )
        )
        if event.kind is CodeLinkKind.branch:
            return AutomationTrigger.branch_created
        if event.kind is CodeLinkKind.pull_request:
            # A pull request SoftTrack is seeing for the first time *already*
            # merged -- a webhook added after the fact, or a redelivery of an
            # old event -- is the merge, not the opening. Reporting it as
            # "opened" would move the issue to In Review and leave it there.
            return (
                AutomationTrigger.pull_request_merged
                if event.state is PullRequestState.merged
                else AutomationTrigger.pull_request_opened
            )
        return None

    # Titles get edited and pull requests change state; both are worth keeping
    # current, and neither is worth a row of its own.
    became_merged = (
        event.kind is CodeLinkKind.pull_request
        and event.state is PullRequestState.merged
        and existing.state is not PullRequestState.merged
    )
    changed = False
    for field, value in (
        ("title", event.title),
        ("url", event.url),
        ("state", event.state),
        ("author_name", event.author_name),
    ):
        if value is not None and getattr(existing, field) != value:
            setattr(existing, field, value)
            changed = True
    if changed:
        existing.updated_at = datetime.now(timezone.utc)
        session.add(existing)

    return AutomationTrigger.pull_request_merged if became_merged else None
