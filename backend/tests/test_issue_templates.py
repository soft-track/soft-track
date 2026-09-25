"""Per-team issue description templates (#97)."""

import pytest


def join(client, team, person, role="member"):
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": person["user"]["email"], "role": role},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text


def create(
    client, actor, team_id, name="Bug report", body="## Steps\n\n1. ", expect=200
):
    response = client.post(
        f"/teams/{team_id}/issue-templates",
        json={"name": name, "body": body},
        headers=actor["headers"],
    )
    assert response.status_code == expect, response.text
    return response.json()


def listed(client, actor, team_id):
    response = client.get(f"/teams/{team_id}/issue-templates", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def member(client, team, auth):
    person = auth(email="member@softtrack.dev", full_name="Plain Member")
    join(client, team, person)
    return person


def test_a_new_team_has_no_templates(client, team):
    """Nothing is seeded: teams opt in by writing their own."""
    assert listed(client, team, team["team"]["id"]) == []


def test_an_admin_creates_one_and_members_can_read_it(client, team, member):
    team_id = team["team"]["id"]
    created = create(client, team, team_id, name="  Bug report ", body="## Steps\n")
    assert created["name"] == "Bug report"
    assert created["body"] == "## Steps"
    assert created["position"] == 0

    [seen] = listed(client, member, team_id)
    assert seen["id"] == created["id"]


def test_guests_can_read_them_too(client, team, auth):
    guest = auth(email="guest@softtrack.dev", full_name="Guest")
    join(client, team, guest, "guest")
    create(client, team, team["team"]["id"])
    assert len(listed(client, guest, team["team"]["id"])) == 1


def test_members_cannot_manage_them(client, team, member):
    team_id = team["team"]["id"]
    create(client, member, team_id, expect=403)
    template = create(client, team, team_id)
    for method, path, body in (
        ("PATCH", f"/issue-templates/{template['id']}", {"name": "Mine"}),
        ("DELETE", f"/issue-templates/{template['id']}", None),
        (
            "PUT",
            f"/teams/{team_id}/issue-templates/order",
            {"template_ids": [template["id"]]},
        ),
    ):
        response = client.request(method, path, json=body, headers=member["headers"])
        assert response.status_code == 403, (method, path)
        assert response.json()["code"] == "not_team_admin"


def test_outsiders_cannot_read_them(client, team, auth):
    stranger = auth(email="stranger@softtrack.dev", full_name="Stranger")
    response = client.get(
        f"/teams/{team['team']['id']}/issue-templates", headers=stranger["headers"]
    )
    assert response.status_code == 403


def test_new_ones_go_to_the_end(client, team):
    team_id = team["team"]["id"]
    create(client, team, team_id, name="Bug report")
    create(client, team, team_id, name="Feature request")
    create(client, team, team_id, name="Spike")
    assert [t["name"] for t in listed(client, team, team_id)] == [
        "Bug report",
        "Feature request",
        "Spike",
    ]


def test_names_are_unique_per_team_ignoring_case(client, team, auth):
    team_id = team["team"]["id"]
    create(client, team, team_id, name="Bug report")
    response = client.post(
        f"/teams/{team_id}/issue-templates",
        json={"name": "bug REPORT", "body": "x"},
        headers=team["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "template_name_taken"

    # Another team is another namespace.
    other = auth(email="ops@softtrack.dev", full_name="Ops")
    ops = client.post(
        "/teams", json={"name": "Operations", "key": "OPS"}, headers=other["headers"]
    ).json()
    create(client, other, ops["id"], name="Bug report")


def test_blank_text_is_refused(client, team):
    team_id = team["team"]["id"]
    response = client.post(
        f"/teams/{team_id}/issue-templates",
        json={"name": "Empty", "body": "   \n "},
        headers=team["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "body_required"


def test_editing_a_template(client, team):
    team_id = team["team"]["id"]
    template = create(client, team, team_id)
    response = client.patch(
        f"/issue-templates/{template['id']}",
        json={"name": "Bug", "body": "## Repro\n\n## Expected"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Bug"
    assert response.json()["body"] == "## Repro\n\n## Expected"
    assert response.json()["updated_at"] >= template["updated_at"]


def test_renaming_to_its_own_name_is_fine(client, team):
    template = create(client, team, team["team"]["id"])
    response = client.patch(
        f"/issue-templates/{template['id']}",
        json={"name": "BUG REPORT"},
        headers=team["headers"],
    )
    assert response.status_code == 200


def test_renaming_onto_another_is_refused(client, team):
    team_id = team["team"]["id"]
    create(client, team, team_id, name="Bug report")
    spike = create(client, team, team_id, name="Spike")
    response = client.patch(
        f"/issue-templates/{spike['id']}",
        json={"name": "Bug Report"},
        headers=team["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "template_name_taken"


def test_reordering(client, team):
    team_id = team["team"]["id"]
    ids = [create(client, team, team_id, name=n)["id"] for n in ("A", "B", "C")]
    response = client.put(
        f"/teams/{team_id}/issue-templates/order",
        json={"template_ids": [ids[2], ids[0], ids[1]]},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    assert [t["name"] for t in response.json()] == ["C", "A", "B"]
    assert [t["name"] for t in listed(client, team, team_id)] == ["C", "A", "B"]


def test_a_stale_order_is_refused(client, team):
    team_id = team["team"]["id"]
    ids = [create(client, team, team_id, name=n)["id"] for n in ("A", "B")]
    response = client.put(
        f"/teams/{team_id}/issue-templates/order",
        json={"template_ids": [ids[1]]},
        headers=team["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "template_order_incomplete"


def test_deleting_leaves_issues_filed_from_it_alone(client, team):
    team_id = team["team"]["id"]
    template = create(client, team, team_id, body="## Steps\n\n1. open it")
    issue = client.post(
        f"/teams/{team_id}/issues",
        json={"title": "Crash", "description": template["body"]},
        headers=team["headers"],
    ).json()

    response = client.delete(
        f"/issue-templates/{template['id']}", headers=team["headers"]
    )
    assert response.status_code == 204
    assert listed(client, team, team_id) == []
    again = client.get(f"/issues/{issue['id']}", headers=team["headers"]).json()
    assert again["description"] == "## Steps\n\n1. open it"


def test_a_missing_template_is_a_404(client, team):
    response = client.patch(
        "/issue-templates/999", json={"name": "x"}, headers=team["headers"]
    )
    assert response.status_code == 404
    assert response.json()["code"] == "template_not_found"
