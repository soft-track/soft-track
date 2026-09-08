"""Reading GitHub and GitLab deliveries (issue #25).

Payloads as dictionaries, no HTTP: the awkward cases here are a force push
with no commits, a draft pull request, a closed-without-merging one, and a tag
push wearing a push event's clothes -- all of which are shapes rather than
requests. The end-to-end path is in test_integrations.py.
"""

import hashlib
import hmac

import pytest

from lib_softtrack.tables import CodeLinkKind, GitProvider, PullRequestState
from lib_softtrack.webhooks import WebhookError, parse, repository_name, verify

# --- verification ----------------------------------------------------------


def github_headers(secret: str, body: bytes) -> dict[str, str]:
    digest = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return {"x-hub-signature-256": f"sha256={digest}"}


def test_a_correctly_signed_github_delivery_is_accepted():
    body = b'{"zen": "Anything added dilutes everything else."}'
    verify(GitProvider.github, "s3cret", body, github_headers("s3cret", body))


def test_a_github_delivery_signed_with_the_wrong_secret_is_refused():
    body = b'{"a": 1}'
    with pytest.raises(WebhookError) as caught:
        verify(GitProvider.github, "s3cret", body, github_headers("guess", body))
    assert caught.value.status == 401


def test_a_github_delivery_whose_body_was_changed_is_refused():
    """The point of an HMAC over the body rather than a bearer token: a
    payload edited in flight no longer matches its own signature."""
    headers = github_headers("s3cret", b'{"a": 1}')
    with pytest.raises(WebhookError) as caught:
        verify(GitProvider.github, "s3cret", b'{"a": 2}', headers)
    assert caught.value.status == 401


def test_an_unsigned_github_delivery_is_refused():
    with pytest.raises(WebhookError) as caught:
        verify(GitProvider.github, "s3cret", b"{}", {})
    assert caught.value.status == 401


def test_gitlab_compares_the_token_it_sends_back():
    verify(GitProvider.gitlab, "s3cret", b"{}", {"x-gitlab-token": "s3cret"})
    with pytest.raises(WebhookError):
        verify(GitProvider.gitlab, "s3cret", b"{}", {"x-gitlab-token": "guess"})
    with pytest.raises(WebhookError):
        verify(GitProvider.gitlab, "s3cret", b"{}", {})


# --- which repository a delivery claims to be about ------------------------


def test_the_repository_name_is_read_from_both_shapes():
    assert (
        repository_name(GitProvider.github, {"repository": {"full_name": "acme/api"}})
        == "acme/api"
    )
    assert (
        repository_name(
            GitProvider.gitlab, {"project": {"path_with_namespace": "acme/api"}}
        )
        == "acme/api"
    )
    assert repository_name(GitProvider.github, {}) is None


# --- GitHub ----------------------------------------------------------------


def github_push(ref="refs/heads/eng-42-fix", commits=None):
    return {
        "ref": ref,
        "repository": {"full_name": "acme/api", "html_url": "https://gh/acme/api"},
        "pusher": {"name": "sam"},
        "commits": commits if commits is not None else [],
    }


def github_pull_request(**pull):
    return {
        "action": "opened",
        "repository": {"full_name": "acme/api"},
        "pull_request": {
            "number": 7,
            "title": "ENG-42 Fix the thing",
            "html_url": "https://gh/acme/api/pull/7",
            "state": "open",
            "merged": False,
            "head": {"ref": "eng-42-fix"},
            "user": {"login": "sam"},
            "body": "",
            **pull,
        },
    }


def test_a_push_yields_the_branch_and_its_commits():
    events = parse(
        GitProvider.github,
        "push",
        github_push(
            commits=[
                {
                    "id": "abc123",
                    "message": "ENG-42 fix it\n\nlonger body",
                    "url": "https://gh/c/abc123",
                    "author": {"name": "Sam"},
                }
            ]
        ),
    )
    assert [e.kind for e in events] == [CodeLinkKind.branch, CodeLinkKind.commit]

    branch, commit = events
    assert branch.external_id == "eng-42-fix"
    assert branch.url == "https://gh/acme/api/tree/eng-42-fix"
    # Only the subject. An issue page showing a forty-line commit message is
    # an issue page nobody scrolls past.
    assert commit.title == "ENG-42 fix it"
    assert commit.text.startswith("ENG-42 fix it")


def test_a_force_push_with_no_commits_is_still_the_branch():
    events = parse(GitProvider.github, "push", github_push(commits=[]))
    assert [e.kind for e in events] == [CodeLinkKind.branch]


def test_a_tag_push_is_not_a_branch():
    """Same payload shape, none of the meaning -- and "v1.2.0" rendered as a
    branch on an issue page is a link that cannot be checked out."""
    assert parse(GitProvider.github, "push", github_push(ref="refs/tags/v1.2.0")) == []


def test_an_opened_pull_request_is_open():
    (event,) = parse(GitProvider.github, "pull_request", github_pull_request())
    assert event.kind is CodeLinkKind.pull_request
    assert event.external_id == "7"
    assert event.state is PullRequestState.open


def test_a_merged_pull_request_is_merged_not_closed():
    """`action: closed` covers both merging and abandoning, and only one of
    them shipped anything -- so `merged` is what decides."""
    (event,) = parse(
        GitProvider.github,
        "pull_request",
        github_pull_request(state="closed", merged=True),
    )
    assert event.state is PullRequestState.merged


def test_a_pull_request_closed_without_merging_is_closed():
    (event,) = parse(
        GitProvider.github,
        "pull_request",
        github_pull_request(state="closed", merged=False),
    )
    assert event.state is PullRequestState.closed


def test_a_pull_request_is_scanned_in_title_branch_and_body():
    """People put the identifier in whichever of the three they think of."""
    (event,) = parse(
        GitProvider.github,
        "pull_request",
        github_pull_request(
            title="Fix the thing", head={"ref": "wip"}, body="Closes ENG-42"
        ),
    )
    assert "ENG-42" in event.text

    (event,) = parse(
        GitProvider.github,
        "pull_request",
        github_pull_request(title="Fix", head={"ref": "eng-42-fix"}, body=""),
    )
    assert "eng-42-fix" in event.text


def test_a_pull_request_with_a_null_body_does_not_crash():
    # GitHub sends `"body": null` for a description-less pull request.
    (event,) = parse(GitProvider.github, "pull_request", github_pull_request(body=None))
    assert event.state is PullRequestState.open


def test_events_github_does_not_describe_are_accepted_and_ignored():
    """Including `ping`, which is the first thing GitHub ever sends. A 400
    here fills the delivery log with red and teaches people to ignore it."""
    assert parse(GitProvider.github, "ping", {"zen": "..."}) == []
    assert parse(GitProvider.github, "issues", {}) == []


# --- GitLab ----------------------------------------------------------------


def gitlab_push(ref="refs/heads/eng-42-fix", commits=None):
    return {
        "object_kind": "push",
        "ref": ref,
        "project": {
            "path_with_namespace": "acme/api",
            "web_url": "https://gl/acme/api",
        },
        "user_name": "Sam",
        "commits": commits if commits is not None else [],
    }


def gitlab_merge_request(**attributes):
    return {
        "object_kind": "merge_request",
        "project": {"path_with_namespace": "acme/api"},
        "user": {"name": "Sam"},
        "object_attributes": {
            "iid": 3,
            "title": "ENG-42 Fix the thing",
            "url": "https://gl/acme/api/-/merge_requests/3",
            "state": "opened",
            "source_branch": "eng-42-fix",
            "description": "",
            **attributes,
        },
    }


def test_a_gitlab_push_yields_the_branch_and_its_commits():
    events = parse(
        GitProvider.gitlab,
        "Push Hook",
        gitlab_push(
            commits=[
                {
                    "id": "def456",
                    "message": "ENG-42 fix it",
                    "url": "https://gl/c/def456",
                    "author": {"name": "Sam"},
                }
            ]
        ),
    )
    assert [e.kind for e in events] == [CodeLinkKind.branch, CodeLinkKind.commit]
    assert events[0].url == "https://gl/acme/api/-/tree/eng-42-fix"


def test_a_merge_request_uses_the_number_people_see():
    """`iid` is what is in the URL and on the page. `id` is a global database
    key that means nothing to anybody reading the issue."""
    (event,) = parse(
        GitProvider.gitlab, "Merge Request Hook", gitlab_merge_request(id=99999, iid=3)
    )
    assert event.external_id == "3"


def test_gitlab_states_map_onto_the_same_three():
    for raw, expected in (
        ("opened", PullRequestState.open),
        ("merged", PullRequestState.merged),
        ("closed", PullRequestState.closed),
    ):
        (event,) = parse(
            GitProvider.gitlab, "Merge Request Hook", gitlab_merge_request(state=raw)
        )
        assert event.state is expected


def test_gitlab_events_that_are_not_described_are_ignored():
    assert parse(GitProvider.gitlab, "Issue Hook", {}) == []
