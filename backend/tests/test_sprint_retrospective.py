"""A sprint's goal, and its retrospective when it ends (#271).

A sprint says what it is for when it is planned. Completing it asks whether
that was met and starts a retrospective -- what went well, what did not,
what to change -- which anybody on the team but a guest can add to until a
team admin closes it. A line from "what to change" becomes a ticket, linked
back to the sprint it came from.
"""

from datetime import datetime, timedelta, timezone

import pytest

START = datetime(2026, 9, 21, tzinfo=timezone.utc)
GOAL = "A customer can sign in to the portal and see their invoices."


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def sprint(client, team):
    return _ok(
        client.post(
            f"/teams/{team['team']['id']}/sprints",
            json={
                "name": "Sprint 14",
                "starts_at": START.isoformat(),
                "ends_at": (START + timedelta(days=14)).isoformat(),
                "goal": f"  {GOAL}  ",
            },
            headers=team["headers"],
        )
    )


def complete(client, team, sprint, **body):
    _ok(client.post(f"/sprints/{sprint['id']}/start", headers=team["headers"]))
    return client.post(
        f"/sprints/{sprint['id']}/complete",
        json=body or None,
        headers=team["headers"],
    )


def join(client, team, auth, email, role):
    person = auth(email=email, full_name=email.split("@")[0].title())
    _ok(
        client.post(
            f"/teams/{team['team']['id']}/members",
            json={"email": email, "role": role},
            headers=team["headers"],
        )
    )
    return person


def test_a_sprint_says_what_it_is_for(client, team, sprint):
    assert sprint["goal"] == GOAL
    assert sprint["goal_outcome"] is None
    # No retrospective before there is anything to look back on.
    assert sprint["retrospective"] is None
    changed = _ok(
        client.patch(
            f"/sprints/{sprint['id']}",
            json={"goal": "Sign in, and see invoices."},
            headers=team["headers"],
        )
    )
    assert changed["goal"] == "Sign in, and see invoices."
    cleared = _ok(
        client.patch(
            f"/sprints/{sprint['id']}", json={"goal": "  "}, headers=team["headers"]
        )
    )
    assert cleared["goal"] is None


def test_completing_asks_whether_the_goal_was_met_and_starts_the_retrospective(
    client, team, sprint
):
    response = complete(
        client,
        team,
        sprint,
        outcome="partly",
        went_well="Sign-in shipped on day six.",
        did_not="The PDF bug was found on the last Thursday.",
    )
    done = _ok(response)["sprint"]
    assert done["goal_outcome"] == "partly"
    assert done["retrospective"] == {
        "went_well": "Sign-in shipped on day six.",
        "did_not": "The PDF bug was found on the last Thursday.",
        "to_change": None,
        "closed_at": None,
        "actions": [],
    }


def test_completing_asks_nothing_it_has_to_have(client, team, sprint):
    done = _ok(complete(client, team, sprint))["sprint"]
    assert done["state"] == "completed"
    assert done["goal_outcome"] is None
    assert done["retrospective"]["went_well"] is None


def test_the_retrospective_is_filled_in_later_by_anybody_but_a_guest(
    client, team, sprint, auth
):
    member = join(client, team, auth, "daniel@softtrack.dev", "member")
    guest = join(client, team, auth, "sofia@client.dev", "guest")
    complete(client, team, sprint)

    path = f"/sprints/{sprint['id']}/retrospective"
    written = _ok(
        client.patch(
            path,
            json={"to_change": "- Regression pass starts on day seven."},
            headers=member["headers"],
        )
    )
    assert (
        written["retrospective"]["to_change"]
        == "- Regression pass starts on day seven."
    )
    outcome = _ok(
        client.patch(path, json={"outcome": "met"}, headers=member["headers"])
    )
    assert outcome["goal_outcome"] == "met"
    # Left out stays; null clears.
    assert outcome["retrospective"]["to_change"] is not None
    cleared = _ok(
        client.patch(path, json={"to_change": None}, headers=member["headers"])
    )
    assert cleared["retrospective"]["to_change"] is None

    refused = client.patch(path, json={"went_well": "x"}, headers=guest["headers"])
    assert refused.status_code == 403
    assert refused.json()["code"] == "team_read_only"
    # Guests read all of it.
    assert (
        client.get(f"/sprints/{sprint['id']}", headers=guest["headers"]).status_code
        == 200
    )


def test_a_retrospective_is_about_a_sprint_that_has_ended(client, team, sprint):
    refused = client.patch(
        f"/sprints/{sprint['id']}/retrospective",
        json={"went_well": "Too soon"},
        headers=team["headers"],
    )
    assert refused.status_code == 409
    assert refused.json()["code"] == "sprint_not_completed"


def test_a_team_admin_closes_it(client, team, sprint, auth):
    member = join(client, team, auth, "daniel@softtrack.dev", "member")
    complete(client, team, sprint)
    close = f"/sprints/{sprint['id']}/retrospective/close"
    assert client.post(close, headers=member["headers"]).status_code == 403
    closed = _ok(client.post(close, headers=team["headers"]))
    assert closed["retrospective"]["closed_at"] is not None

    refused = client.patch(
        f"/sprints/{sprint['id']}/retrospective",
        json={"went_well": "Late thought"},
        headers=member["headers"],
    )
    assert refused.status_code == 409
    assert refused.json()["code"] == "retrospective_closed"


def test_an_action_becomes_a_ticket_linked_back_to_the_sprint(client, team, sprint):
    complete(
        client, team, sprint, to_change="- Review requests wait no more than a day."
    )
    action = _ok(
        client.post(
            f"/sprints/{sprint['id']}/retrospective/actions",
            json={"text": " Review requests wait no more than a day. "},
            headers=team["headers"],
        )
    )
    assert action["text"] == "Review requests wait no more than a day."
    assert action["identifier"].startswith("ENG-")

    ticket = _ok(client.get(f"/tickets/{action['ticket_id']}", headers=team["headers"]))
    assert ticket["title"] == "Review requests wait no more than a day."
    assert ticket["description"] == "From the retrospective of Sprint 14."
    assert ticket["sprint_id"] is None

    again = _ok(client.get(f"/sprints/{sprint['id']}", headers=team["headers"]))
    assert [a["identifier"] for a in again["retrospective"]["actions"]] == [
        action["identifier"]
    ]
    listed = _ok(
        client.get(f"/teams/{team['team']['id']}/sprints", headers=team["headers"])
    )
    assert listed[0]["retrospective"]["actions"][0]["ticket_id"] == action["ticket_id"]


def test_a_purged_action_ticket_leaves_the_line(client, team, sprint):
    complete(client, team, sprint)
    action = _ok(
        client.post(
            f"/sprints/{sprint['id']}/retrospective/actions",
            json={"text": "Pair on the release checklist."},
            headers=team["headers"],
        )
    )
    h = team["headers"]
    assert (
        client.delete(f"/tickets/{action['ticket_id']}", headers=h).status_code == 204
    )
    assert (
        client.delete(f"/trash/tickets/{action['ticket_id']}", headers=h).status_code
        == 204
    )
    again = _ok(client.get(f"/sprints/{sprint['id']}", headers=h))
    assert again["retrospective"]["actions"] == []
