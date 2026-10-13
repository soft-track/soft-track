"""Sprint capacity (#269): what each person can take, against what they have."""

import pytest
from sqlmodel import select

from lib_softtrack.tables import SprintCapacity
from tests.conftest import status_ids

H = 60


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def eng(client, auth):
    """Amina owns Engineering; Daniel and Mei are members, Carol a guest.
    Sprint 1 runs 5 Oct to 18 Oct 2026: two weeks, ten working days."""
    people = {
        "amina": auth(email="amina@northwind.dev", full_name="Amina Khan"),
        "daniel": auth(email="daniel@northwind.dev", full_name="Daniel Okafor"),
        "mei": auth(email="mei@northwind.dev", full_name="Mei Tanaka"),
        "carol": auth(email="carol@northwind.dev", full_name="Carol Client"),
    }
    amina = people["amina"]
    team = _ok(
        client.post(
            "/teams",
            json={"name": "Engineering", "key": "ENG"},
            headers=amina["headers"],
        )
    )
    for name, role in (("daniel", "member"), ("mei", "member"), ("carol", "guest")):
        _ok(
            client.post(
                f"/teams/{team['id']}/members",
                json={"email": people[name]["user"]["email"], "role": role},
                headers=amina["headers"],
            )
        )
    sprint = sprint_of(client, amina, team, "2026-10-05", "2026-10-18")
    return {
        **people,
        "team": team,
        "sprint": sprint,
        "status": status_ids(client, amina, team["id"]),
    }


def sprint_of(client, actor, team, starts, ends):
    """A sprint as the app makes one: from midnight to the last second of the
    last day."""
    return _ok(
        client.post(
            f"/teams/{team['id']}/sprints",
            json={"starts_at": f"{starts}T00:00:00Z", "ends_at": f"{ends}T23:59:59Z"},
            headers=actor["headers"],
        )
    )


def ticket(client, eng, who=None, sprint=None, time_estimate_minutes=None, **fields):
    """A ticket in the sprint; a time estimate (#268) is set once it exists."""
    created = _ok(
        client.post(
            f"/teams/{eng['team']['id']}/tickets",
            json={
                "title": "Work",
                "sprint_id": (sprint or eng["sprint"])["id"],
                "assignee_id": eng[who]["user"]["id"] if who else None,
                **fields,
            },
            headers=eng["amina"]["headers"],
        )
    )
    if time_estimate_minutes is not None:
        created = _ok(
            client.patch(
                f"/tickets/{created['id']}",
                json={"time_estimate_minutes": time_estimate_minutes},
                headers=eng["amina"]["headers"],
            )
        )
    return created


def plan(client, eng, actor="amina", sprint=None):
    return _ok(
        client.get(
            f"/sprints/{(sprint or eng['sprint'])['id']}/plan",
            headers=eng[actor]["headers"],
        )
    )


def set_capacity(client, eng, *people, actor="amina", sprint=None):
    return client.put(
        f"/sprints/{(sprint or eng['sprint'])['id']}/capacity",
        json={"people": list(people)},
        headers=eng[actor]["headers"],
    )


def row(found, eng, name):
    return next(
        r for r in found["people"] if r["person"]["id"] == eng[name]["user"]["id"]
    )


# --- the default --------------------------------------------------------------


def test_everybody_who_can_be_assigned_starts_from_the_teams_default(client, eng):
    found = plan(client, eng)
    assert found["working_days"] == 10
    assert found["estimate_unit"] == "points"
    assert [r["person"]["full_name"] for r in found["people"]] == [
        "Amina Khan",
        "Daniel Okafor",
        "Mei Tanaka",
    ]
    daniel = row(found, eng, "daniel")
    assert daniel["days_here"] == 10 and daniel["days_off"] == 0
    assert daniel["points_capacity"] == 10 and not daniel["points_set"]
    assert daniel["minutes_capacity"] == 10 * 6 * H
    assert found["capacity_points"] == 30


def test_a_guest_has_no_capacity_and_no_row(client, eng):
    found = plan(client, eng, actor="carol")
    assert eng["carol"]["user"]["id"] not in [
        r["person"]["id"] for r in found["people"]
    ]
    refused = set_capacity(
        client, eng, {"user_id": eng["carol"]["user"]["id"], "points": 4}
    )
    assert refused.status_code == 400
    assert refused.json()["code"] == "user_not_on_team"


def test_a_guest_cannot_set_capacity(client, eng):
    refused = set_capacity(
        client,
        eng,
        {"user_id": eng["daniel"]["user"]["id"], "points": 4},
        actor="carol",
    )
    assert refused.status_code == 403


def test_a_sprint_ending_at_midnight_ends_the_day_before(client, eng):
    sprint = _ok(
        client.post(
            f"/teams/{eng['team']['id']}/sprints",
            json={"starts_at": "2026-10-05T00:00:00", "ends_at": "2026-10-12T00:00:00"},
            headers=eng["amina"]["headers"],
        )
    )
    assert plan(client, eng, sprint=sprint)["working_days"] == 5


def test_the_teams_default_is_a_setting(client, eng):
    _ok(
        client.patch(
            f"/teams/{eng['team']['id']}",
            json={"capacity_points": 8, "capacity_minutes_per_day": 5 * H},
            headers=eng["amina"]["headers"],
        )
    )
    daniel = row(plan(client, eng), eng, "daniel")
    assert daniel["points_capacity"] == 8
    assert daniel["minutes_capacity"] == 10 * 5 * H
    refused = client.patch(
        f"/teams/{eng['team']['id']}",
        json={"capacity_points": -1},
        headers=eng["amina"]["headers"],
    )
    assert refused.status_code == 422


# --- assigned against capacity ------------------------------------------------


def test_each_row_is_assigned_against_capacity_and_unassigned_is_its_own(client, eng):
    ticket(client, eng, "daniel", estimate=8)
    ticket(client, eng, "daniel", estimate=5, status_id=eng["status"]["Done"])
    ticket(client, eng, "mei", estimate=3)
    ticket(client, eng, estimate=2)
    ticket(client, eng, estimate=3)
    # Not in the sprint, so not in the plan.
    _ok(
        client.patch(
            f"/tickets/{ticket(client, eng, 'mei', estimate=8)['id']}",
            json={"sprint_id": None},
            headers=eng["amina"]["headers"],
        )
    )

    found = plan(client, eng)
    daniel = row(found, eng, "daniel")
    # Over capacity, and assigning was not refused: the plan never gates.
    assert (daniel["points_assigned"], daniel["points_capacity"]) == (13, 10)
    assert daniel["tickets"] == 2
    assert row(found, eng, "mei")["points_assigned"] == 3
    assert row(found, eng, "amina")["points_assigned"] == 0
    assert found["unassigned"] == {"tickets": 2, "points": 5, "minutes": 0}
    assert found["scope_points"] == 21
    assert found["capacity_points"] == 30


def test_hours_are_the_time_estimates_of_their_tickets(client, eng):
    _ok(
        client.patch(
            f"/teams/{eng['team']['id']}",
            json={"estimate_unit": "hours"},
            headers=eng["amina"]["headers"],
        )
    )
    ticket(client, eng, "daniel", time_estimate_minutes=20 * H)
    ticket(client, eng, time_estimate_minutes=3 * H)

    found = plan(client, eng)
    assert found["estimate_unit"] == "hours"
    daniel = row(found, eng, "daniel")
    assert (daniel["minutes_assigned"], daniel["minutes_capacity"]) == (20 * H, 60 * H)
    assert found["unassigned"]["minutes"] == 3 * H
    assert found["scope_minutes"] == 23 * H
    assert found["capacity_minutes"] == 3 * 60 * H


def test_work_left_with_somebody_no_longer_on_the_team_is_still_scope(
    client, eng, session
):
    ticket(client, eng, "mei", estimate=5, status_id=eng["status"]["Done"])
    left = client.delete(
        f"/teams/{eng['team']['id']}/members/{eng['mei']['user']['id']}",
        headers=eng["amina"]["headers"],
    )
    assert left.status_code == 204, left.text
    found = plan(client, eng)
    assert eng["mei"]["user"]["id"] not in [r["person"]["id"] for r in found["people"]]
    assert found["elsewhere"] == {"tickets": 1, "points": 5, "minutes": 0}
    assert found["scope_points"] == 5


# --- per person, per sprint ---------------------------------------------------


def test_days_away_take_capacity_away_in_proportion(client, eng):
    found = _ok(
        set_capacity(
            client,
            eng,
            {"user_id": eng["mei"]["user"]["id"], "days_off": 2},
            {"user_id": eng["daniel"]["user"]["id"], "days_off": 1},
        )
    )
    mei = row(found, eng, "mei")
    assert (mei["days_here"], mei["days_off"]) == (8, 2)
    assert mei["points_capacity"] == 8
    assert mei["minutes_capacity"] == 8 * 6 * H
    assert row(found, eng, "daniel")["points_capacity"] == 9


def test_a_capacity_set_by_hand_replaces_the_default_in_its_unit(client, eng):
    amina = eng["amina"]["user"]["id"]
    found = _ok(set_capacity(client, eng, {"user_id": amina, "points": 6}))
    mine = row(found, eng, "amina")
    assert (mine["points_capacity"], mine["points_set"]) == (6, True)
    assert (mine["minutes_capacity"], mine["minutes_set"]) == (60 * H, False)

    # Days away do not move a capacity set by hand; sending it as null hands
    # it back to the default, and leaving a field out leaves it.
    found = _ok(set_capacity(client, eng, {"user_id": amina, "days_off": 5}))
    assert row(found, eng, "amina")["points_capacity"] == 6
    found = _ok(set_capacity(client, eng, {"user_id": amina, "points": None}))
    mine = row(found, eng, "amina")
    assert (mine["points_capacity"], mine["points_set"], mine["days_off"]) == (
        5,
        False,
        5,
    )


def test_capacity_is_per_sprint(client, eng):
    other = sprint_of(client, eng["amina"], eng["team"], "2026-10-19", "2026-10-30")
    _ok(set_capacity(client, eng, {"user_id": eng["mei"]["user"]["id"], "points": 2}))
    assert row(plan(client, eng, sprint=other), eng, "mei")["points_capacity"] == 10


def test_a_completed_sprints_capacity_is_history(client, eng):
    _ok(
        client.post(
            f"/sprints/{eng['sprint']['id']}/start", headers=eng["amina"]["headers"]
        )
    )
    _ok(
        client.post(
            f"/sprints/{eng['sprint']['id']}/complete", headers=eng["amina"]["headers"]
        )
    )
    refused = set_capacity(
        client, eng, {"user_id": eng["mei"]["user"]["id"], "points": 2}
    )
    assert refused.status_code == 409
    assert refused.json()["code"] == "sprint_completed"


def test_deleting_a_sprint_takes_its_capacities(client, eng, session):
    _ok(set_capacity(client, eng, {"user_id": eng["mei"]["user"]["id"], "points": 2}))
    response = client.delete(
        f"/sprints/{eng['sprint']['id']}", headers=eng["amina"]["headers"]
    )
    assert response.status_code == 204, response.text
    assert session.exec(select(SprintCapacity)).all() == []


def test_a_team_deleted_by_a_site_admin_takes_its_capacities(client, eng, session):
    _ok(set_capacity(client, eng, {"user_id": eng["mei"]["user"]["id"], "points": 2}))
    # Amina registered first, so she is the site admin; the team has no
    # tickets, so it can be deleted.
    response = client.delete(
        f"/admin/teams/{eng['team']['id']}", headers=eng["amina"]["headers"]
    )
    assert response.status_code in (200, 204), response.text
    assert session.exec(select(SprintCapacity)).all() == []


# --- a suggestion from history --------------------------------------------------


def _delivered(client, eng, points, starts, ends):
    """A completed sprint that delivered `points`, and left a 3 unfinished."""
    sprint = sprint_of(client, eng["amina"], eng["team"], starts, ends)
    ticket(client, eng, "daniel", sprint=sprint, estimate=3)
    done = eng["status"]["Done"]
    while points:
        size = next(size for size in (8, 5, 3, 2, 1) if size <= points)
        ticket(
            client,
            eng,
            "daniel",
            sprint=sprint,
            estimate=size,
            status_id=done,
            time_estimate_minutes=size * H,
        )
        points -= size
    h = eng["amina"]["headers"]
    _ok(client.post(f"/sprints/{sprint['id']}/start", headers=h))
    _ok(client.post(f"/sprints/{sprint['id']}/complete", headers=h))


def test_the_last_three_sprints_are_a_line_to_plan_against(client, eng):
    assert plan(client, eng)["average_points"] is None
    for points, (starts, ends) in zip(
        (50, 34, 39, 36),
        (
            ("2026-08-10", "2026-08-21"),
            ("2026-08-24", "2026-09-04"),
            ("2026-09-07", "2026-09-18"),
            ("2026-09-21", "2026-10-02"),
        ),
    ):
        _delivered(client, eng, points, starts, ends)

    found = plan(client, eng)
    assert [s["points_delivered"] for s in found["history"]] == [34, 39, 36]
    assert [s["minutes_delivered"] for s in found["history"]] == [
        34 * H,
        39 * H,
        36 * H,
    ]
    # 109 / 3 = 36.3: a suggestion, rounded.
    assert found["average_points"] == 36
    assert found["average_minutes"] == (34 + 39 + 36) * H // 3


# --- across teams ---------------------------------------------------------------


def test_somebody_on_two_teams_has_a_capacity_in_each(client, eng):
    mei, amina = eng["mei"], eng["amina"]
    design = _ok(
        client.post(
            "/teams",
            json={"name": "Product & Design", "key": "PD"},
            headers=amina["headers"],
        )
    )
    _ok(
        client.post(
            f"/teams/{design['id']}/members",
            json={"email": mei["user"]["email"]},
            headers=amina["headers"],
        )
    )
    _ok(
        client.patch(
            f"/teams/{design['id']}",
            json={"capacity_points": 3},
            headers=amina["headers"],
        )
    )
    design_sprint = sprint_of(client, amina, design, "2026-10-05", "2026-10-18")
    _ok(
        client.post(
            f"/teams/{design['id']}/tickets",
            json={
                "title": "Mock it up",
                "sprint_id": design_sprint["id"],
                "assignee_id": mei["user"]["id"],
                "estimate": 2,
            },
            headers=amina["headers"],
        )
    )
    ticket(client, eng, "mei", estimate=8)
    _ok(set_capacity(client, eng, {"user_id": mei["user"]["id"], "days_off": 2}))

    workload = _ok(
        client.get(
            f"/users/{mei['user']['username']}/workload", headers=amina["headers"]
        )
    )
    assert [
        (c["team"]["name"], c["sprint"], c["points_assigned"], c["points_capacity"])
        for c in workload["capacity"]
    ] == [("Engineering", "Sprint 1", 8, 8), ("Product & Design", "Sprint 1", 2, 3)]


def test_the_workload_shows_only_teams_the_viewer_shares(client, eng, auth):
    other = auth(email="ravi@northwind.dev", full_name="Ravi Patel")
    elsewhere = _ok(
        client.post(
            "/teams", json={"name": "Support", "key": "SUP"}, headers=other["headers"]
        )
    )
    _ok(
        client.post(
            f"/teams/{elsewhere['id']}/members",
            json={"email": eng["mei"]["user"]["email"]},
            headers=other["headers"],
        )
    )
    sprint_of(client, other, elsewhere, "2026-10-05", "2026-10-18")
    workload = _ok(
        client.get(
            f"/users/{eng['mei']['user']['username']}/workload",
            headers=eng["daniel"]["headers"],
        )
    )
    assert [c["team"]["name"] for c in workload["capacity"]] == ["Engineering"]
