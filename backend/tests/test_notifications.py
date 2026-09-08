"""Notifications: what raises one, who gets it, and what the inbox does (issue #18).

The property most of these are guarding: one thing that happened produces at
most one row per person, and never one for the person who did it.
"""

import pytest
from sqlmodel import select

from lib_softtrack.tables import IssueWatch, Notification, User


@pytest.fixture
def pair(client, team, auth):
    """An admin and a plain member of the same team.

    Almost every case below needs two people -- one to act and one to be
    told -- and a single-user fixture would make every test pass by silence.
    """
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return {**team, "member": member}


def make_issue(client, actor, team, **fields):
    response = client.post(
        f"/teams/{team['id']}/issues",
        json={"title": "Some work", **fields},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def inbox(client, actor, **params):
    response = client.get("/notifications", headers=actor["headers"], params=params)
    assert response.status_code == 200, response.text
    return response.json()["items"]


def comment(client, actor, issue, body):
    response = client.post(
        f"/issues/{issue['id']}/comments", json={"body": body}, headers=actor["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def watching(client, actor, issue) -> bool:
    response = client.get(f"/issues/{issue['id']}/watch", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()["watching"]


def set_watching(client, actor, issue, value):
    return client.put(
        f"/issues/{issue['id']}/watch",
        json={"watching": value},
        headers=actor["headers"],
    )


# --- auto-watching -----------------------------------------------------


def test_filing_an_issue_watches_it(client, pair):
    issue = make_issue(client, pair, pair["team"])
    assert watching(client, pair, issue) is True


def test_being_assigned_an_issue_watches_it(client, pair):
    issue = make_issue(
        client, pair, pair["team"], assignee_id=pair["member"]["user"]["id"]
    )
    assert watching(client, pair["member"], issue) is True


def test_commenting_watches_the_issue(client, pair):
    issue = make_issue(client, pair, pair["team"])
    assert watching(client, pair["member"], issue) is False
    comment(client, pair["member"], issue, "Looking at this")
    assert watching(client, pair["member"], issue) is True


def test_being_mentioned_does_not_watch_the_issue(client, pair):
    """Somebody else naming you is a weaker signal than anything you did.

    You hear about the mention; you do not silently acquire the whole thread.
    """
    issue = make_issue(client, pair, pair["team"], description="ping @member")
    assert watching(client, pair["member"], issue) is False


def test_unwatching_survives_commenting_again(client, pair):
    """The one case a delete-the-row design gets wrong.

    Auto-watch would recreate the row on the next comment, and the mute would
    last until the person next said something.
    """
    issue = make_issue(client, pair, pair["team"])
    assert set_watching(client, pair, issue, False).status_code == 200

    comment(client, pair, issue, "Still here")
    assert watching(client, pair, issue) is False


def test_watching_is_per_person(client, pair):
    issue = make_issue(client, pair, pair["team"])
    set_watching(client, pair["member"], issue, True)
    set_watching(client, pair, issue, False)

    assert watching(client, pair["member"], issue) is True
    assert watching(client, pair, issue) is False


def test_a_non_member_cannot_watch(client, pair, auth):
    outsider = auth(email="outside@softtrack.dev")
    issue = make_issue(client, pair, pair["team"])
    assert set_watching(client, outsider, issue, True).status_code == 403
    assert (
        client.get(
            f"/issues/{issue['id']}/watch", headers=outsider["headers"]
        ).status_code
        == 403
    )


# --- assignment --------------------------------------------------------


def test_assigning_on_creation_tells_the_assignee(client, pair):
    issue = make_issue(
        client, pair, pair["team"], assignee_id=pair["member"]["user"]["id"]
    )

    (item,) = inbox(client, pair["member"])
    assert item["kind"] == "assigned"
    assert item["issue"]["identifier"] == issue["identifier"]
    assert item["issue"]["team_key"] == "ENG"
    assert item["actor"]["id"] == pair["user"]["id"]
    assert item["read"] is False


def test_assigning_on_update_tells_the_new_assignee(client, pair):
    issue = make_issue(client, pair, pair["team"])
    client.patch(
        f"/issues/{issue['id']}",
        json={"assignee_id": pair["member"]["user"]["id"]},
        headers=pair["headers"],
    )

    (item,) = inbox(client, pair["member"])
    assert item["kind"] == "assigned"


def test_assigning_an_issue_to_yourself_tells_nobody(client, pair):
    make_issue(client, pair, pair["team"], assignee_id=pair["user"]["id"])
    assert inbox(client, pair) == []


def test_reassigning_to_the_same_person_does_not_tell_them_twice(client, pair):
    """The notification follows the diff, not the payload."""
    issue = make_issue(
        client, pair, pair["team"], assignee_id=pair["member"]["user"]["id"]
    )
    client.patch(
        f"/issues/{issue['id']}",
        json={"assignee_id": pair["member"]["user"]["id"], "title": "Renamed"},
        headers=pair["headers"],
    )
    assert len(inbox(client, pair["member"])) == 1


# --- mentions ----------------------------------------------------------


def test_a_mention_in_a_description_tells_the_person(client, pair):
    make_issue(client, pair, pair["team"], description="over to @member please")

    (item,) = inbox(client, pair["member"])
    assert item["kind"] == "mentioned"


def test_a_mention_in_a_comment_tells_the_person(client, pair):
    issue = make_issue(client, pair["member"], pair["team"])
    # The author is watching their own issue, so this would be a `commented`
    # row too if mentions did not take precedence.
    comment(client, pair, issue, "what do you think @member?")

    (item,) = inbox(client, pair["member"])
    assert item["kind"] == "mentioned"
    assert item["excerpt"] == "what do you think @member?"


def test_a_handle_inside_code_is_not_a_mention(client, pair):
    """Mirrors the renderer, which only ever rewrites text nodes.

    An issue tracker is mostly shell snippets, and a fenced block full of
    them should not page whoever happens to share a name with a flag.
    """
    issue = make_issue(client, pair, pair["team"])
    comment(client, pair, issue, "run:\n\n```\ncurl -u @member host\n```\n")
    assert inbox(client, pair["member"]) == []

    comment(client, pair, issue, "the `@member` placeholder")
    assert inbox(client, pair["member"]) == []


def test_an_email_address_in_prose_is_not_a_mention(client, pair):
    issue = make_issue(client, pair, pair["team"])
    comment(client, pair, issue, "mail it to plain@member for now")
    assert inbox(client, pair["member"]) == []


def test_a_handle_nobody_has_tells_nobody(client, pair):
    make_issue(client, pair, pair["team"], description="cc @nobody-at-all")
    assert inbox(client, pair["member"]) == []


def test_mentioning_someone_outside_the_team_tells_them_nothing(client, pair, auth):
    """A handle is instance-wide; an issue is not.

    Resolving one against the whole instance would tell a stranger that a
    team they are not in has an issue, and what it is called.
    """
    outsider = auth(email="outside@softtrack.dev")
    make_issue(client, pair, pair["team"], description="cc @outside")
    assert inbox(client, outsider) == []


def test_mentioning_yourself_tells_you_nothing(client, pair):
    make_issue(client, pair, pair["team"], description="note to self @demo")
    assert inbox(client, pair) == []


def test_editing_a_description_does_not_re_mention_anyone(client, pair):
    issue = make_issue(client, pair, pair["team"], description="@member take a look")
    assert len(inbox(client, pair["member"])) == 1

    client.patch(
        f"/issues/{issue['id']}",
        json={"description": "@member take a look, typo fixed"},
        headers=pair["headers"],
    )
    assert len(inbox(client, pair["member"])) == 1


def test_adding_a_mention_to_a_description_tells_the_new_person(client, pair):
    issue = make_issue(client, pair, pair["team"], description="no mentions yet")
    client.patch(
        f"/issues/{issue['id']}",
        json={"description": "actually @member should see this"},
        headers=pair["headers"],
    )

    (item,) = inbox(client, pair["member"])
    assert item["kind"] == "mentioned"


# --- comments and status ------------------------------------------------


def test_a_comment_tells_the_watchers_and_not_the_author(client, pair):
    issue = make_issue(client, pair, pair["team"])
    comment(client, pair["member"], issue, "Fixed in main")

    (item,) = inbox(client, pair)
    assert item["kind"] == "commented"
    assert item["excerpt"] == "Fixed in main"
    assert inbox(client, pair["member"]) == []


def test_a_long_comment_is_trimmed_for_the_inbox(client, pair):
    issue = make_issue(client, pair, pair["team"])
    comment(client, pair["member"], issue, "word " * 200)

    (item,) = inbox(client, pair)
    assert len(item["excerpt"]) <= 140
    assert item["excerpt"].endswith("…")


def test_a_status_change_tells_the_watchers(client, pair):
    """The member filed it, so they are watching it; the admin moves it."""
    issue = make_issue(client, pair["member"], pair["team"])
    client.patch(
        f"/issues/{issue['id']}",
        json={"status_id": pair["status_ids"]["In Progress"]},
        headers=pair["headers"],
    )

    (item,) = inbox(client, pair["member"])
    assert item["kind"] == "status_changed"
    assert item["actor"]["id"] == pair["user"]["id"]
    # And the person who moved it hears nothing, watching or not.
    assert inbox(client, pair) == []


def test_a_status_change_tells_nobody_who_is_not_watching(client, pair):
    issue = make_issue(client, pair, pair["team"])
    client.patch(
        f"/issues/{issue['id']}",
        json={"status_id": pair["status_ids"]["Done"]},
        headers=pair["headers"],
    )
    assert inbox(client, pair["member"]) == []


def test_one_update_is_at_most_one_notification_per_person(client, pair):
    """Assigned *and* moved is one thing that happened, and the assignment
    is the half worth saying."""
    issue = make_issue(client, pair, pair["team"])
    set_watching(client, pair["member"], issue, True)

    client.patch(
        f"/issues/{issue['id']}",
        json={
            "assignee_id": pair["member"]["user"]["id"],
            "status_id": pair["status_ids"]["In Progress"],
        },
        headers=pair["headers"],
    )

    items = inbox(client, pair["member"])
    assert [item["kind"] for item in items] == ["assigned"]


def test_a_comment_that_mentions_a_watcher_is_one_notification(client, pair):
    issue = make_issue(client, pair["member"], pair["team"])
    comment(client, pair, issue, "@member have a look")

    items = inbox(client, pair["member"])
    assert [item["kind"] for item in items] == ["mentioned"]


# --- who is still deliverable -------------------------------------------


def test_leaving_the_team_stops_the_notifications(client, pair):
    """Watches outlive membership; delivery must not."""
    issue = make_issue(client, pair["member"], pair["team"])
    assert watching(client, pair["member"], issue) is True

    client.delete(
        f"/teams/{pair['team']['id']}/members/{pair['member']['user']['id']}",
        headers=pair["headers"],
    )
    comment(client, pair, issue, "Anyone?")

    assert (
        client.get("/notifications", headers=pair["member"]["headers"]).json()["items"]
        == []
    )


def test_a_deactivated_account_is_not_notified(client, pair, session):
    issue = make_issue(client, pair["member"], pair["team"])

    member = session.get(User, pair["member"]["user"]["id"])
    member.is_active = False
    session.add(member)
    session.commit()

    comment(client, pair, issue, "Anyone?")
    assert (
        session.exec(
            select(Notification).where(Notification.user_id == member.id)
        ).all()
        == []
    )


# --- the inbox ----------------------------------------------------------


def test_the_inbox_is_newest_first(client, pair):
    issue = make_issue(client, pair, pair["team"])
    comment(client, pair["member"], issue, "first")
    comment(client, pair["member"], issue, "second")

    assert [item["excerpt"] for item in inbox(client, pair)] == ["second", "first"]


def test_marking_one_read_and_unread_again(client, pair):
    issue = make_issue(client, pair, pair["team"])
    comment(client, pair["member"], issue, "hello")
    (item,) = inbox(client, pair)

    response = client.patch(
        f"/notifications/{item['id']}", json={"read": True}, headers=pair["headers"]
    )
    assert response.status_code == 200, response.text
    assert response.json()["read"] is True
    assert inbox(client, pair, unread_only=True) == []

    client.patch(
        f"/notifications/{item['id']}", json={"read": False}, headers=pair["headers"]
    )
    assert len(inbox(client, pair, unread_only=True)) == 1


def test_the_unread_count_is_the_badge(client, pair):
    issue = make_issue(client, pair, pair["team"])
    comment(client, pair["member"], issue, "one")
    comment(client, pair["member"], issue, "two")

    def count():
        return client.get("/notifications/unread-count", headers=pair["headers"]).json()

    assert count() == {"unread": 2}

    response = client.post("/notifications/read-all", headers=pair["headers"])
    assert response.status_code == 200, response.text
    assert response.json() == {"unread": 0}
    assert count() == {"unread": 0}
    # Read, not deleted: the inbox still has the history.
    assert len(inbox(client, pair)) == 2


def test_somebody_elses_notification_is_a_404(client, pair):
    """404 rather than 403 -- the caller has no business learning the id exists."""
    issue = make_issue(client, pair, pair["team"])
    comment(client, pair["member"], issue, "hello")
    (item,) = inbox(client, pair)

    response = client.patch(
        f"/notifications/{item['id']}",
        json={"read": True},
        headers=pair["member"]["headers"],
    )
    assert response.status_code == 404


def test_read_all_only_touches_your_own(client, pair):
    issue = make_issue(client, pair, pair["team"])
    set_watching(client, pair["member"], issue, True)
    comment(client, pair["member"], issue, "mine")
    client.patch(
        f"/issues/{issue['id']}",
        json={"status_id": pair["status_ids"]["Done"]},
        headers=pair["headers"],
    )
    assert len(inbox(client, pair["member"], unread_only=True)) == 1

    client.post("/notifications/read-all", headers=pair["headers"])
    assert len(inbox(client, pair["member"], unread_only=True)) == 1


def test_deleting_an_issue_clears_its_inbox_rows(client, pair, session):
    """They would otherwise be links to a 404 -- and foreign keys to a row
    that no longer exists, which Postgres rejects outright."""
    issue = make_issue(client, pair, pair["team"])
    comment(client, pair["member"], issue, "hello")
    assert len(inbox(client, pair)) == 1

    response = client.delete(f"/issues/{issue['id']}", headers=pair["headers"])
    assert response.status_code == 204, response.text

    assert inbox(client, pair) == []
    assert session.exec(select(Notification)).all() == []
    assert session.exec(select(IssueWatch)).all() == []


# --- preferences ---------------------------------------------------------


def test_email_is_on_by_default_and_can_be_switched_off(client, pair):
    response = client.get("/notifications/settings", headers=pair["headers"])
    assert response.status_code == 200, response.text
    assert response.json() == {
        "email_notifications": True,
        # No SMTP host in the test settings, so the frontend knows to hide
        # the switch rather than promise a digest nothing will send.
        "email_delivery_configured": False,
    }

    response = client.patch(
        "/notifications/settings",
        json={"email_notifications": False},
        headers=pair["headers"],
    )
    assert response.status_code == 200, response.text
    assert response.json()["email_notifications"] is False

    assert (
        client.get("/notifications/settings", headers=pair["headers"]).json()[
            "email_notifications"
        ]
        is False
    )


def test_switching_email_off_leaves_the_inbox_alone(client, pair):
    client.patch(
        "/notifications/settings",
        json={"email_notifications": False},
        headers=pair["headers"],
    )
    issue = make_issue(client, pair, pair["team"])
    comment(client, pair["member"], issue, "hello")

    assert len(inbox(client, pair)) == 1
