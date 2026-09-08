"""Saved views: who can see one, who can change one, and where you land (issue #21).

The two properties most of these guard: a private view is invisible to
everybody but its owner, and nothing can leave a person defaulted to a view
they cannot see.
"""

import pytest


@pytest.fixture
def pair(client, team, auth):
    """A team admin and a plain member -- the shape sharing questions need."""
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return {**team, "member": member}


def create_view(client, actor, team_id, name="My view", shared=False, **filters):
    response = client.post(
        f"/teams/{team_id}/views",
        json={"name": name, "is_shared": shared, "filters": filters},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def views(client, actor, team_id):
    response = client.get(f"/teams/{team_id}/views", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def names(payload):
    return [item["name"] for item in payload["items"]]


# --- what a view stores -------------------------------------------------


def test_a_view_round_trips_its_filters(client, pair):
    view = create_view(
        client,
        pair,
        pair["team"]["id"],
        name="Urgent in review",
        status_id=pair["status_ids"]["In Review"],
        priority="urgent",
    )
    assert view["filters"]["status_id"] == pair["status_ids"]["In Review"]
    assert view["filters"]["priority"] == "urgent"
    assert view["owner"]["id"] == pair["user"]["id"]
    # Everything unset stays unset rather than becoming a filter that matches
    # nothing.
    assert view["filters"]["label_id"] is None
    assert view["filters"]["unassigned"] is False


def test_a_view_with_no_filters_is_all_issues(client, pair):
    view = create_view(client, pair, pair["team"]["id"], name="Everything")
    assert all(value in (None, False) for value in view["filters"].values())


def test_filtering_on_an_assignee_and_on_unassigned_is_rejected(client, pair):
    """They are contradictory, and the pair would silently match nothing."""
    response = client.post(
        f"/teams/{pair['team']['id']}/views",
        json={
            "name": "Impossible",
            "filters": {"assignee_id": pair["user"]["id"], "unassigned": True},
        },
        headers=pair["headers"],
    )
    assert response.status_code == 422


def test_a_filter_pointing_at_another_teams_label_is_rejected(client, pair, auth):
    """Otherwise the view saves and then matches nothing for ever, which reads
    as broken filtering rather than a bad reference."""
    other = auth(email="other@softtrack.dev")
    other_team = client.post(
        "/teams", json={"name": "Design", "key": "DSG"}, headers=other["headers"]
    ).json()
    foreign_label = client.post(
        f"/teams/{other_team['id']}/labels",
        json={"name": "Theirs"},
        headers=other["headers"],
    ).json()

    response = client.post(
        f"/teams/{pair['team']['id']}/views",
        json={"name": "Borrowed", "filters": {"label_id": foreign_label["id"]}},
        headers=pair["headers"],
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "No such label on this team"


def test_a_filter_on_someone_outside_the_team_is_rejected(client, pair, auth):
    outsider = auth(email="outside@softtrack.dev")
    response = client.post(
        f"/teams/{pair['team']['id']}/views",
        json={"name": "Nobody", "filters": {"assignee_id": outsider["user"]["id"]}},
        headers=pair["headers"],
    )
    assert response.status_code == 400


# --- who can see one ----------------------------------------------------


def test_a_private_view_is_invisible_to_a_teammate(client, pair):
    create_view(client, pair, pair["team"]["id"], name="Mine")
    assert names(views(client, pair, pair["team"]["id"])) == ["Mine"]
    assert names(views(client, pair["member"], pair["team"]["id"])) == []


def test_sharing_a_view_hands_it_to_the_team(client, pair):
    view = create_view(client, pair, pair["team"]["id"], name="Ours")
    response = client.patch(
        f"/views/{view['id']}", json={"is_shared": True}, headers=pair["headers"]
    )
    assert response.status_code == 200, response.text
    assert names(views(client, pair["member"], pair["team"]["id"])) == ["Ours"]


def test_somebody_elses_private_view_is_a_404(client, pair):
    """404 rather than 403 -- the name of a view says what a team is working
    on, and "you may not see this" says it exists."""
    view = create_view(client, pair, pair["team"]["id"], name="Secret")
    response = client.patch(
        f"/views/{view['id']}",
        json={"name": "Renamed"},
        headers=pair["member"]["headers"],
    )
    assert response.status_code == 404


def test_a_non_member_cannot_read_the_teams_views(client, pair, auth):
    outsider = auth(email="outside@softtrack.dev")
    response = client.get(
        f"/teams/{pair['team']['id']}/views", headers=outsider["headers"]
    )
    assert response.status_code == 403


def test_shared_views_come_before_private_ones(client, pair):
    create_view(client, pair, pair["team"]["id"], name="Zebra", shared=True)
    create_view(client, pair, pair["team"]["id"], name="Apple")
    create_view(client, pair, pair["team"]["id"], name="Banana", shared=True)

    assert names(views(client, pair, pair["team"]["id"])) == [
        "Banana",
        "Zebra",
        "Apple",
    ]


# --- who can change one -------------------------------------------------


def test_the_owner_edits_and_deletes_their_own(client, pair):
    view = create_view(client, pair["member"], pair["team"]["id"], name="Mine")

    renamed = client.patch(
        f"/views/{view['id']}",
        json={"name": "Mine, renamed", "filters": {"priority": "high"}},
        headers=pair["member"]["headers"],
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Mine, renamed"
    assert renamed.json()["filters"]["priority"] == "high"

    assert (
        client.delete(
            f"/views/{view['id']}", headers=pair["member"]["headers"]
        ).status_code
        == 204
    )
    assert names(views(client, pair["member"], pair["team"]["id"])) == []


def test_a_member_cannot_edit_a_shared_view_they_do_not_own(client, pair):
    view = create_view(client, pair, pair["team"]["id"], name="Ours", shared=True)
    response = client.patch(
        f"/views/{view['id']}",
        json={"name": "Hijacked"},
        headers=pair["member"]["headers"],
    )
    assert response.status_code == 403


def test_an_admin_can_tidy_up_a_shared_view_they_do_not_own(client, pair):
    """A shared view must not become permanent when its author leaves."""
    view = create_view(
        client, pair["member"], pair["team"]["id"], name="Theirs", shared=True
    )
    assert (
        client.delete(f"/views/{view['id']}", headers=pair["headers"]).status_code
        == 204
    )


# --- where the board opens ----------------------------------------------


def set_team_default(client, actor, team_id, view_id):
    return client.put(
        f"/teams/{team_id}/default-view",
        json={"view_id": view_id},
        headers=actor["headers"],
    )


def set_my_default(client, actor, team_id, view_id):
    return client.put(
        f"/teams/{team_id}/default-view/me",
        json={"view_id": view_id},
        headers=actor["headers"],
    )


def test_an_admin_sets_the_team_default(client, pair):
    view = create_view(client, pair, pair["team"]["id"], name="Ours", shared=True)
    response = set_team_default(client, pair, pair["team"]["id"], view["id"])
    assert response.status_code == 200, response.text

    seen = views(client, pair["member"], pair["team"]["id"])
    assert seen["team_default_id"] == view["id"]
    assert seen["effective_default_id"] == view["id"]
    assert seen["my_default_id"] is None


def test_a_member_cannot_set_the_team_default(client, pair):
    view = create_view(client, pair, pair["team"]["id"], name="Ours", shared=True)
    response = set_team_default(client, pair["member"], pair["team"]["id"], view["id"])
    assert response.status_code == 403


def test_a_private_view_cannot_be_the_team_default(client, pair):
    """It would be invisible to everybody it was defaulted for."""
    view = create_view(client, pair, pair["team"]["id"], name="Mine")
    response = set_team_default(client, pair, pair["team"]["id"], view["id"])
    assert response.status_code == 400
    assert "share it first" in response.json()["detail"]


def test_a_personal_override_beats_the_team_default(client, pair):
    theirs = create_view(client, pair, pair["team"]["id"], name="Ours", shared=True)
    set_team_default(client, pair, pair["team"]["id"], theirs["id"])
    mine = create_view(client, pair["member"], pair["team"]["id"], name="Mine")

    response = set_my_default(client, pair["member"], pair["team"]["id"], mine["id"])
    assert response.status_code == 200, response.text

    seen = views(client, pair["member"], pair["team"]["id"])
    assert seen["team_default_id"] == theirs["id"]
    assert seen["my_default_id"] == mine["id"]
    assert seen["effective_default_id"] == mine["id"]

    # And the admin, who set no override, still lands on the team's.
    assert (
        views(client, pair, pair["team"]["id"])["effective_default_id"] == theirs["id"]
    )


def test_clearing_an_override_falls_back_to_the_team_default(client, pair):
    """No override means no preference, not a preference for nothing."""
    theirs = create_view(client, pair, pair["team"]["id"], name="Ours", shared=True)
    set_team_default(client, pair, pair["team"]["id"], theirs["id"])
    mine = create_view(client, pair["member"], pair["team"]["id"], name="Mine")
    set_my_default(client, pair["member"], pair["team"]["id"], mine["id"])

    set_my_default(client, pair["member"], pair["team"]["id"], None)

    seen = views(client, pair["member"], pair["team"]["id"])
    assert seen["my_default_id"] is None
    assert seen["effective_default_id"] == theirs["id"]


def test_deleting_a_view_takes_every_default_pointing_at_it(client, pair):
    view = create_view(client, pair, pair["team"]["id"], name="Ours", shared=True)
    set_team_default(client, pair, pair["team"]["id"], view["id"])
    set_my_default(client, pair["member"], pair["team"]["id"], view["id"])

    assert (
        client.delete(f"/views/{view['id']}", headers=pair["headers"]).status_code
        == 204
    )

    seen = views(client, pair["member"], pair["team"]["id"])
    assert seen["team_default_id"] is None
    assert seen["my_default_id"] is None
    assert seen["effective_default_id"] is None


def test_unsharing_a_view_withdraws_it_from_everyone_but_its_owner(client, pair):
    """The owner can still see it, so their own choice survives; nobody else
    can, so theirs cannot."""
    view = create_view(client, pair, pair["team"]["id"], name="Ours", shared=True)
    set_team_default(client, pair, pair["team"]["id"], view["id"])
    set_my_default(client, pair, pair["team"]["id"], view["id"])
    set_my_default(client, pair["member"], pair["team"]["id"], view["id"])

    client.patch(
        f"/views/{view['id']}", json={"is_shared": False}, headers=pair["headers"]
    )

    owner_sees = views(client, pair, pair["team"]["id"])
    assert owner_sees["team_default_id"] is None
    assert owner_sees["my_default_id"] == view["id"]

    member_sees = views(client, pair["member"], pair["team"]["id"])
    assert member_sees["items"] == []
    assert member_sees["my_default_id"] is None
    assert member_sees["effective_default_id"] is None


def test_clearing_the_team_default_leaves_everyone_on_all_issues(client, pair):
    view = create_view(client, pair, pair["team"]["id"], name="Ours", shared=True)
    set_team_default(client, pair, pair["team"]["id"], view["id"])

    response = set_team_default(client, pair, pair["team"]["id"], None)
    assert response.status_code == 200, response.text
    assert response.json()["team_default_id"] is None
    assert response.json()["effective_default_id"] is None


def test_changing_your_override_replaces_it_rather_than_adding_one(client, pair):
    first = create_view(client, pair["member"], pair["team"]["id"], name="First")
    second = create_view(client, pair["member"], pair["team"]["id"], name="Second")

    set_my_default(client, pair["member"], pair["team"]["id"], first["id"])
    set_my_default(client, pair["member"], pair["team"]["id"], second["id"])

    seen = views(client, pair["member"], pair["team"]["id"])
    assert seen["my_default_id"] == second["id"]


@pytest.fixture
def two_teams(client, pair):
    """The admin also runs a second team, which is where cross-team ids come from."""
    other = client.post(
        "/teams", json={"name": "Design", "key": "DSG"}, headers=pair["headers"]
    ).json()
    view = create_view(client, pair, other["id"], name="Elsewhere", shared=True)
    return {**pair, "other_team": other, "other_view": view}


def test_another_teams_view_cannot_become_this_teams_default(client, two_teams):
    """The caller can see the view -- they run both teams -- so the guard has
    to be about which team it belongs to, not about visibility."""
    response = set_team_default(
        client, two_teams, two_teams["team"]["id"], two_teams["other_view"]["id"]
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "That view is another team's"


def test_another_teams_view_cannot_become_your_default_here(client, two_teams):
    response = set_my_default(
        client, two_teams, two_teams["team"]["id"], two_teams["other_view"]["id"]
    )
    assert response.status_code == 400


def test_a_view_that_does_not_exist_is_a_404(client, pair):
    response = client.patch(
        f"/views/999", json={"name": "Ghost"}, headers=pair["headers"]
    )
    assert response.status_code == 404


@pytest.mark.parametrize(
    "field,detail",
    [
        ("project_id", "No such project on this team"),
        ("cycle_id", "No such cycle on this team"),
    ],
)
def test_a_filter_pointing_at_something_that_does_not_exist_is_rejected(
    client, pair, field, detail
):
    response = client.post(
        f"/teams/{pair['team']['id']}/views",
        json={"name": "Dangling", "filters": {field: 4321}},
        headers=pair["headers"],
    )
    assert response.status_code == 400
    assert response.json()["detail"] == detail


# --- referential tidiness ------------------------------------------------


def test_deleting_a_cycle_clears_the_views_that_filtered_on_it(client, pair):
    cycle = client.post(
        f"/teams/{pair['team']['id']}/cycles",
        json={"starts_at": "2026-01-01T00:00:00Z", "ends_at": "2026-01-15T00:00:00Z"},
        headers=pair["headers"],
    ).json()
    view = create_view(
        client, pair, pair["team"]["id"], name="This cycle", cycle_id=cycle["id"]
    )

    assert (
        client.delete(f"/cycles/{cycle['id']}", headers=pair["headers"]).status_code
        == 204
    )

    (still_there,) = views(client, pair, pair["team"]["id"])["items"]
    assert still_there["id"] == view["id"]
    # Left pointing at a deleted cycle it would match nothing, which reads as
    # broken rather than empty.
    assert still_there["filters"]["cycle_id"] is None
