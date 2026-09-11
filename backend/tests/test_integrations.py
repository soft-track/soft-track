"""Connecting a repository and receiving its webhooks, end to end (issue #25).

The properties these guard, in the order they would hurt:

* A delivery nobody could sign changes nothing, and a delivery about another
  repository changes nothing either.
* Text from one team's repository can never reach another team's issues.
* A redelivery -- the button both providers put in their UI -- is harmless.
  Links are upserted and triggers fire on transitions, so pressing it ten
  times does not post ten comments.
* A merged pull request moves the issue, and a closed one does not.
"""

import hashlib
import hmac
import json

import pytest

from lib_softtrack.tables import Repository


@pytest.fixture
def connected(client, team):
    """A team with one connected GitHub repository."""
    response = client.post(
        f"/teams/{team['team']['id']}/repositories",
        json={"provider": "github", "full_name": "acme/api"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return {**team, "repo": response.json()}


def hook_path(repo, provider="github"):
    """The path segment of the webhook URL the API handed back."""
    return f"/webhooks/{provider}/" + repo["webhook_url"].rsplit("/", 1)[1]


def deliver(client, repo, event, payload, provider="github", secret=None):
    """POST a delivery signed the way the provider would sign it."""
    body = json.dumps(payload).encode()
    secret = secret if secret is not None else repo["secret"]
    if provider == "github":
        digest = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        headers = {
            "X-Hub-Signature-256": f"sha256={digest}",
            "X-GitHub-Event": event,
            "Content-Type": "application/json",
        }
    else:
        headers = {
            "X-Gitlab-Token": secret,
            "X-Gitlab-Event": event,
            "Content-Type": "application/json",
        }
    return client.post(hook_path(repo, provider), content=body, headers=headers)


def make_issue(client, actor, team_id, title="Work", **fields):
    response = client.post(
        f"/teams/{team_id}/issues",
        json={"title": title, **fields},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def code_links(client, actor, issue_id):
    response = client.get(f"/issues/{issue_id}/code-links", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def get_issue(client, actor, issue_id):
    response = client.get(f"/issues/{issue_id}", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def push(ref="refs/heads/eng-1-fix", commits=None):
    return {
        "ref": ref,
        "repository": {"full_name": "acme/api", "html_url": "https://gh/acme/api"},
        "pusher": {"name": "sam"},
        "commits": commits or [],
    }


def pull_request(number=7, state="open", merged=False, title="ENG-1 Fix it", body=""):
    return {
        "action": "opened",
        "repository": {"full_name": "acme/api"},
        "pull_request": {
            "number": number,
            "title": title,
            "html_url": f"https://gh/acme/api/pull/{number}",
            "state": state,
            "merged": merged,
            "head": {"ref": "eng-1-fix"},
            "user": {"login": "sam"},
            "body": body,
        },
    }


# --- connecting ------------------------------------------------------------


def test_connecting_hands_back_a_url_and_a_secret(client, team):
    response = client.post(
        f"/teams/{team['team']['id']}/repositories",
        json={"provider": "github", "full_name": "acme/api"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    repo = response.json()
    assert repo["full_name"] == "acme/api"
    assert repo["webhook_url"].endswith(repo["webhook_url"].rsplit("/", 1)[1])
    assert "/webhooks/github/" in repo["webhook_url"]
    assert len(repo["secret"]) > 20
    # Nothing has happened yet, and the page has to be able to say so.
    assert repo["last_delivery_at"] is None


def test_a_url_is_refused_because_it_would_never_match(client, team):
    """Pasting the browser URL is the obvious mistake, and accepting it would
    mean comparing it against the "acme/api" every payload carries."""
    response = client.post(
        f"/teams/{team['team']['id']}/repositories",
        json={"provider": "github", "full_name": "https://github.com/acme/api"},
        headers=team["headers"],
    )
    assert response.status_code == 422


def test_the_same_repository_cannot_be_connected_twice_to_one_team(client, connected):
    response = client.post(
        f"/teams/{connected['team']['id']}/repositories",
        json={"provider": "github", "full_name": "acme/api"},
        headers=connected["headers"],
    )
    assert response.status_code == 400


def test_only_admins_can_see_the_secrets(client, connected, auth):
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    client.post(
        f"/teams/{connected['team']['id']}/members",
        json={"email": "member@softtrack.dev"},
        headers=connected["headers"],
    )
    response = client.get(
        f"/teams/{connected['team']['id']}/repositories", headers=member["headers"]
    )
    assert response.status_code == 403


def test_rotating_moves_the_secret_and_the_url_together(client, connected):
    """A half-rotated connection is a state nobody should have to reason
    about, so the old URL dies with the old secret."""
    before = connected["repo"]
    response = client.post(
        f"/repositories/{before['id']}/rotate", headers=connected["headers"]
    )
    assert response.status_code == 200, response.text
    after = response.json()
    assert after["secret"] != before["secret"]
    assert after["webhook_url"] != before["webhook_url"]

    # The old URL is gone, not merely unsigned.
    assert deliver(client, before, "push", push()).status_code == 404


# --- refusing what it should refuse ----------------------------------------


def test_a_delivery_with_a_bad_signature_changes_nothing(client, connected):
    issue = make_issue(client, connected, connected["team"]["id"])
    response = deliver(
        client, connected["repo"], "push", push(), secret="not-the-secret"
    )
    assert response.status_code == 401
    assert code_links(client, connected, issue["id"])["branches"] == []


def test_an_unsigned_delivery_is_refused(client, connected):
    response = client.post(
        hook_path(connected["repo"]),
        content=b"{}",
        headers={"X-GitHub-Event": "push"},
    )
    assert response.status_code == 401


def test_an_unknown_webhook_token_is_a_404(client, connected):
    """Not a 401: there is nothing here to be unauthorised for, and "wrong
    secret" would confirm the token is a real one."""
    response = client.post(
        "/webhooks/github/not-a-real-token",
        content=b"{}",
        headers={"X-GitHub-Event": "push"},
    )
    assert response.status_code == 404


def test_a_delivery_about_another_repository_is_refused(client, connected):
    """The webhook pasted onto the wrong repository. The signature proves who
    sent it; this proves what it is about."""
    issue = make_issue(client, connected, connected["team"]["id"])
    payload = push()
    payload["repository"]["full_name"] = "acme/www"

    response = deliver(client, connected["repo"], "push", payload)
    assert response.status_code == 400
    assert "acme/www" in json.dumps(response.json())
    assert code_links(client, connected, issue["id"])["branches"] == []


def test_a_gitlab_secret_is_not_accepted_on_the_github_route(client, connected):
    """The provider is part of the lookup, so a connection cannot be driven
    through the other provider's endpoint and its weaker check."""
    response = client.post(
        f"/webhooks/gitlab/{connected['repo']['webhook_url'].rsplit('/', 1)[1]}",
        content=b"{}",
        headers={"X-Gitlab-Token": connected["repo"]["secret"]},
    )
    assert response.status_code == 404


# --- linking ---------------------------------------------------------------


def test_a_push_links_the_branch_and_the_commit(client, connected):
    issue = make_issue(client, connected, connected["team"]["id"])
    response = deliver(
        client,
        connected["repo"],
        "push",
        push(
            commits=[
                {
                    "id": "abc123",
                    "message": "ENG-1 fix it",
                    "url": "https://gh/c/abc123",
                    "author": {"name": "Sam"},
                }
            ]
        ),
    )
    assert response.status_code == 200, response.text
    assert response.json()["issues"] == ["ENG-1"]

    links = code_links(client, connected, issue["id"])
    assert [b["external_id"] for b in links["branches"]] == ["eng-1-fix"]
    assert [c["external_id"] for c in links["commits"]] == ["abc123"]
    assert links["commits"][0]["author_name"] == "Sam"
    assert links["commits"][0]["repository"]["full_name"] == "acme/api"


def test_a_pull_request_is_linked_with_its_state(client, connected):
    issue = make_issue(client, connected, connected["team"]["id"])
    deliver(client, connected["repo"], "pull_request", pull_request())

    links = code_links(client, connected, issue["id"])
    assert [p["external_id"] for p in links["pull_requests"]] == ["7"]
    assert links["pull_requests"][0]["state"] == "open"


def test_a_delivery_naming_nothing_is_accepted_and_says_so(client, connected):
    """`events: 1, links: 0` in the provider's delivery log is the answer to
    the question somebody debugging this is about to ask."""
    make_issue(client, connected, connected["team"]["id"])
    response = deliver(
        client, connected["repo"], "push", push(ref="refs/heads/no-identifier-here")
    )
    assert response.status_code == 200
    assert response.json() == {"events": 1, "links": 0, "issues": []}


def test_a_ping_is_accepted(client, connected):
    """The first thing GitHub ever sends. It also proves the wiring works,
    which is why it still stamps last_delivery_at."""
    response = deliver(client, connected["repo"], "ping", {"zen": "..."})
    assert response.status_code == 200
    assert response.json()["events"] == 0

    repos = client.get(
        f"/teams/{connected['team']['id']}/repositories", headers=connected["headers"]
    ).json()
    assert repos[0]["last_delivery_at"] is not None


def test_a_pull_request_naming_two_issues_links_both(client, connected):
    first = make_issue(client, connected, connected["team"]["id"])
    second = make_issue(client, connected, connected["team"]["id"])
    deliver(
        client,
        connected["repo"],
        "pull_request",
        pull_request(title="Fix things", body="Closes ENG-1 and ENG-2"),
    )
    assert len(code_links(client, connected, first["id"])["pull_requests"]) == 1
    assert len(code_links(client, connected, second["id"])["pull_requests"]) == 1


def test_a_repository_cannot_reach_another_teams_issues(client, connected, auth):
    """The boundary, over HTTP this time. A commit message in acme/api that
    deliberately names a DES issue must not touch it."""
    other = auth(email="other@softtrack.dev", full_name="Other Person")
    other_team = client.post(
        "/teams", json={"name": "Design", "key": "DES"}, headers=other["headers"]
    ).json()
    theirs = make_issue(client, other, other_team["id"], title="Theirs")

    response = deliver(
        client, connected["repo"], "push", push(ref="refs/heads/des-1-sneaky")
    )
    assert response.status_code == 200
    assert response.json()["links"] == 0
    assert code_links(client, other, theirs["id"])["branches"] == []


def test_a_flood_of_commits_is_capped(client, connected):
    """A rebase of a long-lived branch can carry hundreds, and an issue page
    listing three hundred commits is one nobody reads past the first screen."""
    from lib_softtrack.integrations import MAX_COMMITS_PER_DELIVERY

    issue = make_issue(client, connected, connected["team"]["id"])
    commits = [
        {
            "id": f"sha{n:03d}",
            "message": "ENG-1 step",
            "url": f"https://gh/c/{n}",
            "author": {"name": "Sam"},
        }
        for n in range(MAX_COMMITS_PER_DELIVERY + 10)
    ]
    deliver(client, connected["repo"], "push", push(commits=commits))

    links = code_links(client, connected, issue["id"])
    assert len(links["commits"]) == MAX_COMMITS_PER_DELIVERY
    # The branch is not sacrificed to the cap.
    assert len(links["branches"]) == 1


# --- redelivery ------------------------------------------------------------


def test_redelivering_the_same_push_does_not_duplicate_anything(client, connected):
    """Both providers put a "redeliver" button in the UI, and people press it
    while they are debugging exactly this."""
    issue = make_issue(client, connected, connected["team"]["id"])
    payload = push(
        commits=[
            {
                "id": "abc123",
                "message": "ENG-1 fix it",
                "url": "https://gh/c/abc123",
                "author": {"name": "Sam"},
            }
        ]
    )
    for _ in range(3):
        assert deliver(client, connected["repo"], "push", payload).status_code == 200

    links = code_links(client, connected, issue["id"])
    assert len(links["branches"]) == 1
    assert len(links["commits"]) == 1


def test_a_pull_request_title_edit_updates_the_link(client, connected):
    issue = make_issue(client, connected, connected["team"]["id"])
    deliver(client, connected["repo"], "pull_request", pull_request())
    deliver(
        client,
        connected["repo"],
        "pull_request",
        pull_request(title="ENG-1 Fix it properly"),
    )

    links = code_links(client, connected, issue["id"])
    assert len(links["pull_requests"]) == 1
    assert links["pull_requests"][0]["title"] == "ENG-1 Fix it properly"


# --- what it sets off ------------------------------------------------------


def create_rule(client, actor, team_id, name, trigger, **actions):
    response = client.post(
        f"/teams/{team_id}/automation-rules",
        json={"name": name, "trigger": trigger, "conditions": {}, "actions": actions},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def runs(client, actor, team_id):
    response = client.get(f"/teams/{team_id}/automation-runs", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def test_a_branch_sets_off_a_branch_rule(client, connected):
    """The problem the issue opens with: the status had to be moved by hand
    the moment work started."""
    create_rule(
        client,
        connected,
        connected["team"]["id"],
        "Start work",
        "branch_created",
        set_status_id=connected["status_ids"]["In Progress"],
    )
    issue = make_issue(client, connected, connected["team"]["id"])
    deliver(client, connected["repo"], "push", push())

    assert (
        get_issue(client, connected, issue["id"])["status"]["id"]
        == connected["status_ids"]["In Progress"]
    )


def test_a_pull_request_moves_it_to_review_and_a_merge_moves_it_to_done(
    client, connected
):
    team_id = connected["team"]["id"]
    create_rule(
        client,
        connected,
        team_id,
        "In review",
        "pull_request_opened",
        set_status_id=connected["status_ids"]["In Review"],
    )
    create_rule(
        client,
        connected,
        team_id,
        "Shipped",
        "pull_request_merged",
        set_status_id=connected["status_ids"]["Done"],
    )
    issue = make_issue(client, connected, team_id)

    deliver(client, connected["repo"], "pull_request", pull_request())
    assert (
        get_issue(client, connected, issue["id"])["status"]["id"]
        == connected["status_ids"]["In Review"]
    )

    deliver(
        client,
        connected["repo"],
        "pull_request",
        pull_request(state="closed", merged=True),
    )
    assert (
        get_issue(client, connected, issue["id"])["status"]["id"]
        == connected["status_ids"]["Done"]
    )
    assert (
        code_links(client, connected, issue["id"])["pull_requests"][0]["state"]
        == "merged"
    )


def test_abandoning_a_pull_request_does_not_move_the_issue(client, connected):
    """`closed` covers both merging and giving up, and only one of them
    shipped anything. A rule moving the issue to Done on the other would be
    wrong about the one thing it is for."""
    team_id = connected["team"]["id"]
    create_rule(
        client,
        connected,
        team_id,
        "Shipped",
        "pull_request_merged",
        set_status_id=connected["status_ids"]["Done"],
    )
    issue = make_issue(client, connected, team_id)

    deliver(client, connected["repo"], "pull_request", pull_request())
    deliver(
        client,
        connected["repo"],
        "pull_request",
        pull_request(state="closed", merged=False),
    )
    assert (
        get_issue(client, connected, issue["id"])["status"]["id"]
        != connected["status_ids"]["Done"]
    )


def test_a_redelivered_merge_does_not_run_the_rule_twice(client, connected):
    """The reason triggers fire on transitions rather than on deliveries: a
    rule that posts a comment must not post it once per press of GitHub's
    redeliver button."""
    team_id = connected["team"]["id"]
    create_rule(
        client,
        connected,
        team_id,
        "Say so",
        "pull_request_merged",
        comment_body="Shipped.",
    )
    issue = make_issue(client, connected, team_id)

    merged = pull_request(state="closed", merged=True)
    for _ in range(3):
        deliver(client, connected["repo"], "pull_request", merged)

    assert runs(client, connected, team_id)["total"] == 1
    comments = client.get(
        f"/issues/{issue['id']}/comments", headers=connected["headers"]
    ).json()
    assert len(comments["items"]) == 1


def test_a_pull_request_first_seen_already_merged_is_a_merge(client, connected):
    """A webhook added after the fact, or an old event redelivered. Reporting
    it as "opened" would move the issue to In Review and leave it there."""
    team_id = connected["team"]["id"]
    create_rule(
        client,
        connected,
        team_id,
        "In review",
        "pull_request_opened",
        set_status_id=connected["status_ids"]["In Review"],
    )
    create_rule(
        client,
        connected,
        team_id,
        "Shipped",
        "pull_request_merged",
        set_status_id=connected["status_ids"]["Done"],
    )
    issue = make_issue(client, connected, team_id)

    deliver(
        client,
        connected["repo"],
        "pull_request",
        pull_request(state="closed", merged=True),
    )
    assert (
        get_issue(client, connected, issue["id"])["status"]["id"]
        == connected["status_ids"]["Done"]
    )


def test_the_run_log_records_an_automated_move_with_no_actor(client, connected):
    """Nobody in SoftTrack did it. The pusher is a GitHub login, and mapping
    that to an account here is a guess."""
    team_id = connected["team"]["id"]
    create_rule(
        client,
        connected,
        team_id,
        "Start work",
        "branch_created",
        set_status_id=connected["status_ids"]["In Progress"],
    )
    make_issue(client, connected, team_id)
    deliver(client, connected["repo"], "push", push())

    log = runs(client, connected, team_id)
    assert log["total"] == 1
    assert log["items"][0]["trigger"] == "branch_created"
    assert log["items"][0]["actor"] is None


# --- GitLab over HTTP ------------------------------------------------------


@pytest.fixture
def connected_gitlab(client, team):
    response = client.post(
        f"/teams/{team['team']['id']}/repositories",
        json={"provider": "gitlab", "full_name": "acme/api"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return {**team, "repo": response.json()}


def test_a_gitlab_merge_request_links_and_merges(client, connected_gitlab):
    team_id = connected_gitlab["team"]["id"]
    create_rule(
        client,
        connected_gitlab,
        team_id,
        "Shipped",
        "pull_request_merged",
        set_status_id=connected_gitlab["status_ids"]["Done"],
    )
    issue = make_issue(client, connected_gitlab, team_id)

    def merge_request(state):
        return {
            "object_kind": "merge_request",
            "project": {"path_with_namespace": "acme/api"},
            "user": {"name": "Sam"},
            "object_attributes": {
                "iid": 3,
                "title": "ENG-1 Fix it",
                "url": "https://gl/acme/api/-/merge_requests/3",
                "state": state,
                "source_branch": "eng-1-fix",
                "description": "",
            },
        }

    deliver(
        client,
        connected_gitlab["repo"],
        "Merge Request Hook",
        merge_request("opened"),
        provider="gitlab",
    )
    assert len(code_links(client, connected_gitlab, issue["id"])["pull_requests"]) == 1

    deliver(
        client,
        connected_gitlab["repo"],
        "Merge Request Hook",
        merge_request("merged"),
        provider="gitlab",
    )
    assert (
        get_issue(client, connected_gitlab, issue["id"])["status"]["id"]
        == connected_gitlab["status_ids"]["Done"]
    )


# --- cleaning up -----------------------------------------------------------


def test_disconnecting_takes_the_links_off_the_issues(client, connected, session):
    """A branch shown on an issue is a link somebody is meant to click, and
    one from a repository the team no longer has connected goes nowhere."""
    issue = make_issue(client, connected, connected["team"]["id"])
    deliver(client, connected["repo"], "push", push())
    assert len(code_links(client, connected, issue["id"])["branches"]) == 1

    response = client.delete(
        f"/repositories/{connected['repo']['id']}", headers=connected["headers"]
    )
    assert response.status_code == 204
    assert code_links(client, connected, issue["id"])["branches"] == []
    assert session.get(Repository, connected["repo"]["id"]) is None


def test_deleting_an_issue_takes_its_code_links_with_it(client, connected):
    """They hold a foreign key to it -- Postgres rejects the delete otherwise,
    and SQLite does too with foreign keys on, which the suite turns on."""
    issue = make_issue(client, connected, connected["team"]["id"])
    deliver(client, connected["repo"], "push", push())

    response = client.delete(f"/issues/{issue['id']}", headers=connected["headers"])
    assert response.status_code == 204
