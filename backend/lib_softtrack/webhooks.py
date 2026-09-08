"""Turning a GitHub or GitLab webhook into something SoftTrack understands.

Two jobs, both of which have to be right before anything else in the
integration runs:

**Deciding a delivery is genuine.** The webhook endpoints are the only routes
in SoftTrack with no bearer token -- they cannot have one, because the caller
is a CI system, not a person. What stands in for it is a shared secret, and
the two providers spend it differently: GitHub HMACs the request body with it,
GitLab sends it back in a header. Both are compared in constant time.

**Flattening two vendors' payloads into one shape.** Everything downstream --
the identifier scan, the links, the rules -- works on `CodeEvent`, so exactly
one module knows that GitLab calls a pull request a merge request and puts its
number in `object_attributes.iid`. Adding a third provider is a third
`_parse_*` and nothing else.

Deliberately pure: no session, no settings, no clock. A payload goes in and a
list of events comes out, which is what makes the awkward cases -- a force
push, a draft PR, a merge commit that names three issues -- testable as
dictionaries rather than as HTTP.
"""

import hashlib
import hmac
from dataclasses import dataclass
from typing import Any, Optional

from lib_softtrack.tables import CodeLinkKind, GitProvider, PullRequestState

#: Refuse a body larger than this before parsing it. The signature proves a
#: payload came from the repository; it says nothing about its size, and a
#: repository with a runaway CI job should get a 413 rather than an
#: out-of-memory worker. Generous next to a real push payload, which is
#: kilobytes.
MAX_BODY_BYTES = 1024 * 1024

#: The refs a push event is allowed to be about. A tag push carries the same
#: shape and none of the meaning -- nobody names an issue in a tag, and
#: treating `refs/tags/v1.2.0` as a branch would put "v1.2.0" on an issue page
#: as a branch that cannot be checked out.
_BRANCH_PREFIX = "refs/heads/"


@dataclass(frozen=True)
class CodeEvent:
    """One branch, commit or pull request, as SoftTrack sees it.

    `text` is what the identifier scan reads. It is assembled per event rather
    than taken from one field, because which text carries the identifier
    differs by kind: a branch has only its name, a commit has its message, and
    a pull request might name the issue in its title, its body, or the branch
    it came from -- and in practice people use all three.
    """

    kind: CodeLinkKind
    external_id: str
    url: str
    title: Optional[str] = None
    state: Optional[PullRequestState] = None
    author_name: Optional[str] = None
    text: str = ""


class WebhookError(Exception):
    """A delivery that cannot be trusted or cannot be read.

    `status` is what the provider should be told. It matters more than usual
    here: GitHub and GitLab both show the response in their delivery log, and
    that log is the only debugging surface the person setting this up has.
    """

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------


def verify(
    provider: GitProvider, secret: str, body: bytes, headers: dict[str, str]
) -> None:
    """Raise unless this delivery was signed with the repository's secret.

    Header lookups are lower-cased by the caller. Both branches use
    `compare_digest`: a `==` on a signature is a timing oracle, and the thing
    it leaks is the ability to move somebody's issues.
    """
    if provider is GitProvider.github:
        sent = headers.get("x-hub-signature-256", "")
        if not sent:
            raise WebhookError(401, "Missing X-Hub-Signature-256")
        expected = (
            "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        )
        if not hmac.compare_digest(sent, expected):
            raise WebhookError(401, "Signature does not match")
        return

    sent = headers.get("x-gitlab-token", "")
    if not sent:
        raise WebhookError(401, "Missing X-Gitlab-Token")
    if not hmac.compare_digest(sent, secret):
        raise WebhookError(401, "Token does not match")


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def repository_name(provider: GitProvider, payload: dict[str, Any]) -> Optional[str]:
    """The "owner/name" the payload says it is about.

    Checked against the connection so that a webhook pasted onto the wrong
    repository is refused rather than silently linking another project's
    commits to this team's issues. Both providers send it; a payload without
    it is one this module does not handle anyway.
    """
    if provider is GitProvider.github:
        return (payload.get("repository") or {}).get("full_name")
    project = payload.get("project") or {}
    return project.get("path_with_namespace")


def parse(
    provider: GitProvider, event_name: str, payload: dict[str, Any]
) -> list[CodeEvent]:
    """Everything in one delivery worth linking, or an empty list.

    Empty is the normal answer for most deliveries -- a `ping`, a tag push, a
    label being added to a pull request -- and it is not an error. An
    integration that 400s on the events it does not care about fills the
    provider's delivery log with red and teaches people to ignore it.
    """
    if provider is GitProvider.github:
        if event_name == "push":
            return _github_push(payload)
        if event_name == "pull_request":
            return _github_pull_request(payload)
        return []

    if event_name in ("Push Hook", "push"):
        return _gitlab_push(payload)
    if event_name in ("Merge Request Hook", "merge_request"):
        return _gitlab_merge_request(payload)
    return []


def _branch_from_ref(ref: str | None) -> Optional[str]:
    if not ref or not ref.startswith(_BRANCH_PREFIX):
        return None
    return ref[len(_BRANCH_PREFIX) :] or None


def _subject(message: str | None) -> Optional[str]:
    """A commit's first line. The rest is the body, and an issue page showing
    a forty-line commit message is an issue page nobody scrolls past."""
    if not message:
        return None
    return message.strip().splitlines()[0] if message.strip() else None


def _github_push(payload: dict[str, Any]) -> list[CodeEvent]:
    branch = _branch_from_ref(payload.get("ref"))
    if branch is None:
        return []

    repo_url = (payload.get("repository") or {}).get("html_url") or ""
    events: list[CodeEvent] = [
        CodeEvent(
            kind=CodeLinkKind.branch,
            external_id=branch,
            url=f"{repo_url}/tree/{branch}" if repo_url else "",
            author_name=(payload.get("pusher") or {}).get("name"),
            text=branch,
        )
    ]

    # A deleted branch still arrives as a push, with no commits. Nothing to
    # add, and the branch row already recorded stays -- see CodeLink.state for
    # why a deleted branch is not something to display as deleted.
    for commit in payload.get("commits") or []:
        sha = commit.get("id")
        if not sha:
            continue
        message = commit.get("message")
        events.append(
            CodeEvent(
                kind=CodeLinkKind.commit,
                external_id=sha,
                url=commit.get("url") or "",
                title=_subject(message),
                author_name=(commit.get("author") or {}).get("name"),
                text=message or "",
            )
        )
    return events


def _github_pull_request(payload: dict[str, Any]) -> list[CodeEvent]:
    pull = payload.get("pull_request") or {}
    number = pull.get("number")
    if number is None:
        return []

    # `merged` rather than the action, because "closed" covers both merging and
    # abandoning and only one of them shipped anything.
    if pull.get("merged"):
        state = PullRequestState.merged
    elif pull.get("state") == "closed":
        state = PullRequestState.closed
    else:
        state = PullRequestState.open

    title = pull.get("title") or ""
    body = pull.get("body") or ""
    head = (pull.get("head") or {}).get("ref") or ""

    return [
        CodeEvent(
            kind=CodeLinkKind.pull_request,
            external_id=str(number),
            url=pull.get("html_url") or "",
            title=title or f"#{number}",
            state=state,
            author_name=(pull.get("user") or {}).get("login"),
            # Title, branch and body, because people put the identifier in
            # whichever of the three they think of first.
            text=f"{title}\n{head}\n{body}",
        )
    ]


def _gitlab_push(payload: dict[str, Any]) -> list[CodeEvent]:
    branch = _branch_from_ref(payload.get("ref"))
    if branch is None:
        return []

    repo_url = (payload.get("project") or {}).get("web_url") or ""
    events: list[CodeEvent] = [
        CodeEvent(
            kind=CodeLinkKind.branch,
            external_id=branch,
            url=f"{repo_url}/-/tree/{branch}" if repo_url else "",
            author_name=payload.get("user_name"),
            text=branch,
        )
    ]

    for commit in payload.get("commits") or []:
        sha = commit.get("id")
        if not sha:
            continue
        message = commit.get("message")
        events.append(
            CodeEvent(
                kind=CodeLinkKind.commit,
                external_id=sha,
                url=commit.get("url") or "",
                title=_subject(message),
                author_name=(commit.get("author") or {}).get("name"),
                text=message or "",
            )
        )
    return events


def _gitlab_merge_request(payload: dict[str, Any]) -> list[CodeEvent]:
    attributes = payload.get("object_attributes") or {}
    # `iid` is the number people see and the one in the URL; `id` is a global
    # database key that means nothing to anybody reading the issue page.
    number = attributes.get("iid")
    if number is None:
        return []

    raw_state = attributes.get("state")
    if raw_state == "merged":
        state = PullRequestState.merged
    elif raw_state == "closed":
        state = PullRequestState.closed
    else:
        state = PullRequestState.open

    title = attributes.get("title") or ""
    description = attributes.get("description") or ""
    source = attributes.get("source_branch") or ""

    return [
        CodeEvent(
            kind=CodeLinkKind.pull_request,
            external_id=str(number),
            url=attributes.get("url") or "",
            title=title or f"!{number}",
            state=state,
            author_name=(payload.get("user") or {}).get("name"),
            text=f"{title}\n{source}\n{description}",
        )
    ]
