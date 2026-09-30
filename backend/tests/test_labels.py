"""Renaming, recolouring and deleting a team's labels (#321).

A label is a row that tickets, saved views and automation rules point at, so
a rename is one change every ticket follows, and a delete has to say what
happens to everything pointing at it.
"""

import pytest
from sqlmodel import select

from lib_softtrack.tables import AutomationRule, SavedView


@pytest.fixture
def board(client, team, auth):
    """ENG with a member, three labels and tickets carrying them."""
    team_id = team["team"]["id"]
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    client.post(
        f"/teams/{team_id}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )

    def label(name, color="#ef4444"):
        response = client.post(
            f"/teams/{team_id}/labels",
            json={"name": name, "color": color},
            headers=team["headers"],
        )
        assert response.status_code == 200, response.text
        return response.json()

    labels = {name: label(name) for name in ("Bug", "Feature", "Release 1.2")}

    def ticket(title, *names):
        response = client.post(
            f"/teams/{team_id}/tickets",
            json={"title": title, "label_ids": [labels[n]["id"] for n in names]},
            headers=team["headers"],
        )
        assert response.status_code == 200, response.text
        return response.json()

    tickets = {
        "both": ticket("Carries both", "Release 1.2", "Feature"),
        "release": ticket("Release only", "Release 1.2"),
        "bug": ticket("A bug", "Bug"),
    }
    return {**team, "team_id": team_id, "member": member, "labels": labels, **tickets}


def names_on(client, board, ticket):
    response = client.get(f"/tickets/{ticket['id']}", headers=board["headers"])
    return sorted(label["name"] for label in response.json()["labels"])


def patch(client, actor, label, **body):
    return client.patch(f"/labels/{label['id']}", json=body, headers=actor["headers"])


def usage(client, actor, board):
    response = client.get(
        f"/teams/{board['team_id']}/labels/usage", headers=actor["headers"]
    )
    assert response.status_code == 200, response.text
    return {row["label_id"]: row for row in response.json()}


# --- names --------------------------------------------------------------------


def test_a_rename_follows_every_ticket(client, board):
    release = board["labels"]["Release 1.2"]
    response = patch(client, board, release, name="  Release 1.2.1 ")
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Release 1.2.1"
    assert names_on(client, board, board["both"]) == ["Feature", "Release 1.2.1"]
    assert names_on(client, board, board["release"]) == ["Release 1.2.1"]


def test_a_member_can_rename_and_recolour(client, board):
    response = patch(
        client, board["member"], board["labels"]["Bug"], name="Defect", color="#0ea5e9"
    )
    assert response.status_code == 200, response.text
    assert (response.json()["name"], response.json()["color"]) == ("Defect", "#0ea5e9")


@pytest.mark.parametrize("name", ["feature", "FEATURE", " Feature "])
def test_a_name_another_label_has_is_refused_in_any_case(client, board, name):
    response = patch(client, board, board["labels"]["Bug"], name=name)
    assert response.status_code == 400
    assert response.json()["code"] == "label_name_taken"
    assert response.json()["detail"].startswith(
        f"“{name.strip()}” is taken by Feature."
    )


def test_creating_a_taken_name_is_refused_too(client, board):
    response = client.post(
        f"/teams/{board['team_id']}/labels",
        json={"name": "bug"},
        headers=board["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "label_name_taken"


def test_a_label_can_change_its_own_case(client, board):
    response = patch(client, board, board["labels"]["Feature"], name="FEATURE")
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "FEATURE"


def test_another_teams_label_does_not_take_the_name(client, board):
    ops = client.post(
        "/teams", json={"name": "Operations", "key": "OPS"}, headers=board["headers"]
    ).json()
    response = client.post(
        f"/teams/{ops['id']}/labels", json={"name": "Bug"}, headers=board["headers"]
    )
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("name", ["", "   "])
def test_a_label_needs_a_name(client, board, name):
    response = patch(client, board, board["labels"]["Bug"], name=name)
    assert response.status_code == 400
    assert response.json()["code"] == "name_required"


def test_a_colour_is_a_hex_colour(client, board):
    assert patch(client, board, board["labels"]["Bug"], color="red").status_code == 422


# --- what points at a label ---------------------------------------------------


def test_usage_counts_tickets_and_names_views_and_rules(client, board, auth):
    release = board["labels"]["Release 1.2"]
    client.post(
        f"/teams/{board['team_id']}/views",
        json={
            "name": "Release 1.2 leftovers",
            "is_shared": True,
            "filters": {"label_id": release["id"]},
        },
        headers=board["headers"],
    )
    # Somebody else's private view: counted, not named.
    client.post(
        f"/teams/{board['team_id']}/views",
        json={"name": "My release list", "filters": {"label_id": release["id"]}},
        headers=board["member"]["headers"],
    )
    client.post(
        f"/teams/{board['team_id']}/automation-rules",
        json={
            "name": "Tag release work",
            "trigger": "ticket_created",
            "conditions": {"if_label_id": release["id"]},
            "actions": {"add_label_id": release["id"]},
        },
        headers=board["headers"],
    )

    rows = usage(client, board, board)
    row = rows[release["id"]]
    assert row["ticket_count"] == 2
    assert [view["name"] for view in row["views"]] == ["Release 1.2 leftovers"]
    assert row["hidden_view_count"] == 1
    # Named once, though it names the label twice.
    assert [rule["name"] for rule in row["rules"]] == ["Tag release work"]
    assert rows[board["labels"]["Bug"]["id"]]["ticket_count"] == 1
    # The member who owns the private view sees it by name.
    mine = usage(client, board["member"], board)[release["id"]]
    assert [view["name"] for view in mine["views"]] == [
        "My release list",
        "Release 1.2 leftovers",
    ]
    assert mine["hidden_view_count"] == 0


# --- deleting -------------------------------------------------------------------


@pytest.fixture
def named(client, board, session):
    """A saved view filtering by Release 1.2, and a rule naming it twice."""
    release = board["labels"]["Release 1.2"]
    view = client.post(
        f"/teams/{board['team_id']}/views",
        json={
            "name": "Release 1.2 leftovers",
            "is_shared": True,
            "filters": {"label_id": release["id"]},
        },
        headers=board["headers"],
    ).json()
    rule = client.post(
        f"/teams/{board['team_id']}/automation-rules",
        json={
            "name": "Tag release work",
            "trigger": "ticket_created",
            "conditions": {"if_label_id": release["id"]},
            "actions": {"add_label_id": release["id"]},
        },
        headers=board["headers"],
    ).json()
    return {**board, "view": view, "rule": rule}


def delete(client, actor, label, **params):
    return client.delete(
        f"/labels/{label['id']}", params=params, headers=actor["headers"]
    )


def labels_of_team(client, board):
    return [
        label["name"]
        for label in client.get(
            f"/teams/{board['team_id']}/labels", headers=board["headers"]
        ).json()
    ]


def test_merging_moves_tickets_views_and_rules_to_the_other_label(
    client, named, session
):
    release, feature = named["labels"]["Release 1.2"], named["labels"]["Feature"]
    response = delete(client, named, release, merge_into=feature["id"])
    assert response.status_code == 204, response.text

    assert labels_of_team(client, named) == ["Bug", "Feature"]
    # The ticket that carried both keeps one Feature.
    assert names_on(client, named, named["both"]) == ["Feature"]
    assert names_on(client, named, named["release"]) == ["Feature"]
    assert session.get(SavedView, named["view"]["id"]).label_id == feature["id"]
    rule = session.get(AutomationRule, named["rule"]["id"])
    assert (rule.if_label_id, rule.add_label_id, rule.is_enabled) == (
        feature["id"],
        feature["id"],
        True,
    )


def test_removing_takes_it_off_tickets_and_views_and_switches_rules_off(
    client, named, session
):
    release = named["labels"]["Release 1.2"]
    assert delete(client, named, release).status_code == 204

    assert labels_of_team(client, named) == ["Bug", "Feature"]
    assert names_on(client, named, named["both"]) == ["Feature"]
    assert names_on(client, named, named["release"]) == []
    # The view widens rather than filtering by a label that is gone.
    assert session.get(SavedView, named["view"]["id"]).label_id is None
    # The rule would match every ticket with its condition cleared, so it is
    # switched off with the label taken out of it.
    rule = session.get(AutomationRule, named["rule"]["id"])
    assert (rule.if_label_id, rule.add_label_id, rule.is_enabled) == (None, None, False)


def test_only_a_team_admin_deletes_a_label(client, board):
    response = delete(client, board["member"], board["labels"]["Bug"])
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_admin"
    assert "Bug" in labels_of_team(client, board)


def test_it_merges_only_into_another_of_the_teams_labels(client, board):
    ops = client.post(
        "/teams", json={"name": "Operations", "key": "OPS"}, headers=board["headers"]
    ).json()
    theirs = client.post(
        f"/teams/{ops['id']}/labels", json={"name": "Bug"}, headers=board["headers"]
    ).json()
    bug = board["labels"]["Bug"]

    elsewhere = delete(client, board, bug, merge_into=theirs["id"])
    assert elsewhere.status_code == 400
    assert elsewhere.json()["code"] == "not_on_this_team"
    itself = delete(client, board, bug, merge_into=bug["id"])
    assert itself.status_code == 400
    assert itself.json()["code"] == "label_merge_into_same"
    assert names_on(client, board, board["bug"]) == ["Bug"]


def test_a_label_that_is_gone_is_a_404(client, board):
    response = client.patch(
        "/labels/9999", json={"name": "Anything"}, headers=board["headers"]
    )
    assert response.status_code == 404
    assert response.json()["code"] == "label_not_found"
