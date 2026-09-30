"""Time tracking: worklogs on tickets (#102)."""

from datetime import date, timedelta

import pytest
from sqlmodel import select

from lib_softtrack.tables import Worklog
from tests.conftest import delete_for_good


def join(client, team, person, role="member"):
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": person["user"]["email"], "role": role},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text


def make_ticket(client, actor, team_id, **fields):
    response = client.post(
        f"/teams/{team_id}/tickets",
        json={"title": "Retry storm", **fields},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def log(client, actor, ticket, minutes=90, expect=200, **fields):
    response = client.post(
        f"/tickets/{ticket['id']}/worklogs",
        json={"minutes": minutes, **fields},
        headers=actor["headers"],
    )
    assert response.status_code == expect, response.text
    return response.json()


def time_on(client, actor, ticket):
    response = client.get(f"/tickets/{ticket['id']}/worklogs", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def maya(client, team, auth):
    person = auth(email="maya@softtrack.dev", full_name="Maya Chen")
    join(client, team, person)
    return person


@pytest.fixture
def ticket(client, team):
    return make_ticket(client, team, team["team"]["id"])


def test_a_ticket_starts_with_no_time(client, team, ticket):
    assert time_on(client, team, ticket) == {
        "total_minutes": 0,
        "by_person": [],
        "entries": [],
    }


def test_logging_time_defaults_to_today(client, team, ticket):
    entry = log(
        client, team, ticket, minutes=150, note="  debugging the webhook retry "
    )
    assert entry["minutes"] == 150
    assert entry["worked_on"] == date.today().isoformat()
    assert entry["note"] == "debugging the webhook retry"
    assert entry["user"]["id"] == team["user"]["id"]


def test_a_day_can_be_chosen(client, team, ticket):
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    assert log(client, team, ticket, worked_on=yesterday)["worked_on"] == yesterday


def test_the_ticket_totals_it_and_says_whose_it_was(client, team, maya, ticket):
    log(client, team, ticket, minutes=30)
    log(client, maya, ticket, minutes=120)
    log(
        client,
        team,
        ticket,
        minutes=45,
        worked_on=(date.today() - timedelta(days=2)).isoformat(),
    )

    time = time_on(client, team, ticket)
    assert time["total_minutes"] == 195
    assert [(p["user"]["full_name"], p["minutes"]) for p in time["by_person"]] == [
        ("Maya Chen", 120),
        ("Demo User", 75),
    ]
    # Most recent day first.
    assert [e["minutes"] for e in time["entries"]][-1] == 45


@pytest.mark.parametrize("minutes", [0, -5, 24 * 60 + 1])
def test_an_entry_is_between_a_minute_and_a_day(client, team, ticket, minutes):
    log(client, team, ticket, minutes=minutes, expect=422)


def test_a_whole_day_is_allowed(client, team, ticket):
    log(client, team, ticket, minutes=24 * 60)


def test_the_future_is_refused(client, team, ticket):
    response = client.post(
        f"/tickets/{ticket['id']}/worklogs",
        json={
            "minutes": 30,
            "worked_on": (date.today() + timedelta(days=3)).isoformat(),
        },
        headers=team["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "worklog_in_future"


def test_tomorrow_is_allowed_for_whoever_is_already_there(client, team, ticket):
    """Somebody's today is UTC's tomorrow for half of every day."""
    log(client, team, ticket, worked_on=(date.today() + timedelta(days=1)).isoformat())


def test_editing_your_own_entry(client, team, ticket):
    entry = log(client, team, ticket, minutes=30, note="first go")
    response = client.patch(
        f"/worklogs/{entry['id']}",
        json={"minutes": 45, "note": ""},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    assert response.json()["minutes"] == 45
    assert response.json()["note"] is None


def test_deleting_your_own_entry(client, team, ticket):
    entry = log(client, team, ticket)
    response = client.delete(f"/worklogs/{entry['id']}", headers=team["headers"])
    assert response.status_code == 204
    assert time_on(client, team, ticket)["total_minutes"] == 0


def test_nobody_else_can_touch_your_entry_not_even_an_admin(client, team, maya, ticket):
    theirs = log(client, maya, ticket)
    for method, body in (("PATCH", {"minutes": 1}), ("DELETE", None)):
        response = client.request(
            method, f"/worklogs/{theirs['id']}", json=body, headers=team["headers"]
        )
        assert response.status_code == 403
        assert response.json()["code"] == "not_your_worklog"


def test_guests_see_time_but_cannot_log_it(client, team, auth, ticket):
    guest = auth(email="guest@softtrack.dev", full_name="Guest")
    join(client, team, guest, "guest")
    log(client, team, ticket, minutes=60)
    assert time_on(client, guest, ticket)["total_minutes"] == 60
    response = client.post(
        f"/tickets/{ticket['id']}/worklogs",
        json={"minutes": 10},
        headers=guest["headers"],
    )
    assert response.status_code == 403
    assert response.json()["code"] == "team_read_only"


def test_outsiders_see_nothing(client, auth, ticket):
    stranger = auth(email="stranger@softtrack.dev", full_name="Stranger")
    response = client.get(
        f"/tickets/{ticket['id']}/worklogs", headers=stranger["headers"]
    )
    assert response.status_code == 403


def test_deleting_the_ticket_deletes_its_time(client, team, ticket, session):
    log(client, team, ticket)
    assert delete_for_good(client, team["headers"], ticket["id"]).status_code == 204
    assert session.exec(select(Worklog)).all() == []


def test_time_travels_with_a_ticket_to_another_team(client, team, ticket):
    """Worklogs belong to the ticket, not the team (#98)."""
    log(client, team, ticket, minutes=40)
    ops = client.post(
        "/teams", json={"name": "Ops", "key": "OPS"}, headers=team["headers"]
    ).json()
    client.post(
        f"/tickets/{ticket['id']}/transfer",
        json={"team_id": ops["id"]},
        headers=team["headers"],
    )
    assert time_on(client, team, ticket)["total_minutes"] == 40


# --- reports -----------------------------------------------------------------


def make_sprint(client, team, start, days=14):
    response = client.post(
        f"/teams/{team['team']['id']}/sprints",
        json={
            "name": "Sprint",
            "starts_at": start.isoformat(),
            "ends_at": (start + timedelta(days=days)).isoformat(),
        },
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_a_sprint_counts_time_logged_during_it_on_its_work(client, team, maya):
    team_id = team["team"]["id"]
    start = date.today() - timedelta(days=5)
    sprint = make_sprint(client, team, start)
    inside = make_ticket(client, team, team_id, sprint_id=sprint["id"])
    outside = make_ticket(client, team, team_id, title="Not in the sprint")

    log(client, team, inside, minutes=60, worked_on=date.today().isoformat())
    log(
        client,
        maya,
        inside,
        minutes=30,
        worked_on=(start + timedelta(days=1)).isoformat(),
    )
    # Before the sprint began: not this sprint's time.
    log(
        client,
        maya,
        inside,
        minutes=500,
        worked_on=(start - timedelta(days=2)).isoformat(),
    )
    log(client, team, outside, minutes=240)

    report = client.get(
        f"/sprints/{sprint['id']}/time-spent", headers=team["headers"]
    ).json()
    assert report["total_minutes"] == 90
    assert [(p["user"]["full_name"], p["minutes"]) for p in report["by_person"]] == [
        ("Demo User", 60),
        ("Maya Chen", 30),
    ]


def test_carrying_a_ticket_over_keeps_its_hours_with_the_sprint_they_were_spent_in(
    client, team
):
    team_id = team["team"]["id"]
    sprint = make_sprint(client, team, date.today() - timedelta(days=3))
    ticket = make_ticket(client, team, team_id, sprint_id=sprint["id"])
    log(client, team, ticket, minutes=120)

    # Moved out of the sprint afterwards -- the time was still spent in it.
    client.patch(
        f"/tickets/{ticket['id']}", json={"sprint_id": None}, headers=team["headers"]
    )
    report = client.get(
        f"/sprints/{sprint['id']}/time-spent", headers=team["headers"]
    ).json()
    assert report["total_minutes"] == 120


def test_a_team_rollup_over_recent_days(client, team, maya):
    team_id = team["team"]["id"]
    ticket = make_ticket(client, team, team_id)
    log(client, team, ticket, minutes=60)
    log(
        client,
        maya,
        ticket,
        minutes=90,
        worked_on=(date.today() - timedelta(days=6)).isoformat(),
    )
    log(
        client,
        maya,
        ticket,
        minutes=45,
        worked_on=(date.today() - timedelta(days=40)).isoformat(),
    )

    week = client.get(
        f"/teams/{team_id}/time-spent", params={"days": 7}, headers=team["headers"]
    ).json()
    assert week["total_minutes"] == 150
    quarter = client.get(
        f"/teams/{team_id}/time-spent", params={"days": 90}, headers=team["headers"]
    ).json()
    assert quarter["total_minutes"] == 195
    assert quarter["by_person"][0]["user"]["full_name"] == "Maya Chen"
