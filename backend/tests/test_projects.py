"""Projects as epics: a lead, a target date, a state, and retiring one (issue #60).

A project is what SoftTrack calls an epic -- the Jira importer already maps
`Epic Link` onto one. What these cover is the lifecycle around it, and above
all what deleting one does to everything that pointed at it.
"""

import pytest
from sqlalchemy import event


@pytest.fixture
def pair(client, team, auth):
    """A team owner and a second member who can lead a project."""
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return {**team, "member": member}


def make_project(client, team, name="Platform", expect=200, **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/projects",
        json={"name": name, **fields},
        headers=team["headers"],
    )
    assert response.status_code == expect, response.text
    return response.json()


def update_project(client, team, project, expect=200, **fields):
    response = client.patch(
        f"/projects/{project['id']}", json=fields, headers=team["headers"]
    )
    assert response.status_code == expect, response.text
    return response.json()


def make_issue(client, team, title="Work", **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- the new fields ------------------------------------------------------


def test_a_new_project_is_planned_unarchived_and_unowned(client, team):
    project = make_project(client, team)
    assert project["state"] == "planned"
    assert project["archived"] is False
    assert project["lead_id"] is None
    assert project["target_date"] is None


def test_a_project_can_be_created_with_a_lead_and_a_target(client, pair):
    project = make_project(
        client,
        pair,
        lead_id=pair["member"]["user"]["id"],
        target_date="2026-12-01",
        state="in_progress",
    )
    assert project["lead_id"] == pair["member"]["user"]["id"]
    assert project["target_date"] == "2026-12-01"
    assert project["state"] == "in_progress"


def test_the_lead_must_be_on_the_team(client, team, auth):
    """A lead from outside could not even see the project they lead."""
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    make_project(client, team, lead_id=outsider["user"]["id"], expect=422)

    project = make_project(client, team)
    update_project(client, team, project, lead_id=outsider["user"]["id"], expect=422)


def test_an_unknown_state_is_refused(client, team):
    make_project(client, team, state="abandoned", expect=422)


# --- updating --------------------------------------------------------------


def test_a_project_can_be_renamed_without_touching_the_rest(client, pair):
    project = make_project(
        client, pair, lead_id=pair["user"]["id"], target_date="2026-12-01"
    )
    renamed = update_project(client, pair, project, name="Platform v2")
    assert renamed["name"] == "Platform v2"
    assert renamed["lead_id"] == pair["user"]["id"]
    assert renamed["target_date"] == "2026-12-01"


def test_an_empty_name_is_refused(client, team):
    project = make_project(client, team)
    update_project(client, team, project, name="", expect=422)


def test_a_project_moves_through_its_states(client, team):
    project = make_project(client, team)
    for state in ("in_progress", "completed", "cancelled", "planned"):
        assert update_project(client, team, project, state=state)["state"] == state


def test_lead_and_target_date_can_be_cleared(client, pair):
    project = make_project(
        client, pair, lead_id=pair["user"]["id"], target_date="2026-12-01"
    )
    cleared = update_project(client, pair, project, lead_id=None, target_date=None)
    assert cleared["lead_id"] is None
    assert cleared["target_date"] is None


def test_a_null_state_is_not_sent_rather_than_blanking_it(client, team):
    """`state` and `archived` are NOT NULL. A null means nothing was sent."""
    project = make_project(client, team, state="in_progress")
    after = update_project(client, team, project, state=None, archived=None)
    assert after["state"] == "in_progress"
    assert after["archived"] is False


def test_only_team_members_can_change_a_project(client, team, auth):
    project = make_project(client, team)
    stranger = auth(email="stranger@softtrack.dev", full_name="Stranger")
    response = client.patch(
        f"/projects/{project['id']}", json={"name": "Mine"}, headers=stranger["headers"]
    )
    assert response.status_code == 403
    response = client.delete(f"/projects/{project['id']}", headers=stranger["headers"])
    assert response.status_code == 403


def test_a_missing_project_is_a_404(client, team):
    assert client.patch(
        "/projects/999", json={"name": "x"}, headers=team["headers"]
    ).status_code == (404)
    assert client.delete("/projects/999", headers=team["headers"]).status_code == 404


# --- archiving ---------------------------------------------------------------


def test_an_archived_project_keeps_its_issues(client, team):
    project = make_project(client, team)
    issue = make_issue(client, team, project_id=project["id"])

    assert update_project(client, team, project, archived=True)["archived"] is True
    survivor = client.get(f"/issues/{issue['id']}", headers=team["headers"]).json()
    assert survivor["project_id"] == project["id"]


def test_an_archived_project_is_still_listed_and_readable(client, team):
    """Issues pointing at it still need a name to show. Pickers filter on
    `archived`; the list does not hide it."""
    project = make_project(client, team)
    update_project(client, team, project, archived=True)

    listed = client.get(
        f"/teams/{team['team']['id']}/projects", headers=team["headers"]
    ).json()
    assert [(p["id"], p["archived"]) for p in listed] == [(project["id"], True)]
    assert (
        client.get(f"/projects/{project['id']}", headers=team["headers"]).json()[
            "archived"
        ]
        is True
    )


def test_an_archived_project_can_be_restored(client, team):
    project = make_project(client, team)
    update_project(client, team, project, archived=True)
    assert update_project(client, team, project, archived=False)["archived"] is False


# --- deleting ------------------------------------------------------------------


def test_deleting_a_project_keeps_its_issues_with_no_project(client, team):
    """The issues are the work. The project was only a way of grouping it."""
    project = make_project(client, team)
    inside = make_issue(client, team, "Inside", project_id=project["id"])
    elsewhere = make_issue(client, team, "Elsewhere")

    response = client.delete(f"/projects/{project['id']}", headers=team["headers"])
    assert response.status_code == 204

    assert (
        client.get(f"/projects/{project['id']}", headers=team["headers"]).status_code
        == 404
    )
    for issue in (inside, elsewhere):
        survivor = client.get(f"/issues/{issue['id']}", headers=team["headers"])
        assert survivor.status_code == 200
        assert survivor.json()["project_id"] is None


def test_deleting_a_project_leaves_other_projects_issues_alone(client, team):
    doomed = make_project(client, team, "Doomed")
    kept = make_project(client, team, "Kept")
    issue = make_issue(client, team, project_id=kept["id"])

    client.delete(f"/projects/{doomed['id']}", headers=team["headers"])
    survivor = client.get(f"/issues/{issue['id']}", headers=team["headers"]).json()
    assert survivor["project_id"] == kept["id"]


def test_deleting_a_project_clears_the_views_that_filtered_on_it(client, team):
    """A view filtering on a project that no longer exists would match
    nothing, which reads as broken rather than empty."""
    project = make_project(client, team)
    response = client.post(
        f"/teams/{team['team']['id']}/views",
        json={"name": "Platform work", "filters": {"project_id": project["id"]}},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    view = response.json()

    client.delete(f"/projects/{project['id']}", headers=team["headers"])

    listed = client.get(
        f"/teams/{team['team']['id']}/views", headers=team["headers"]
    ).json()
    [after] = [v for v in listed["items"] if v["id"] == view["id"]]
    assert after["filters"]["project_id"] is None


def test_deleting_a_project_switches_off_rules_conditioned_on_it(client, team):
    """Clearing the condition alone would widen the rule to every issue the
    team has -- a null condition means "no opinion"."""
    project = make_project(client, team)
    response = client.post(
        f"/teams/{team['team']['id']}/automation-rules",
        json={
            "name": "Platform is urgent",
            "trigger": "issue_created",
            "conditions": {"if_project_id": project["id"]},
            "actions": {"set_priority": "urgent"},
        },
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text

    client.delete(f"/projects/{project['id']}", headers=team["headers"])

    rules = client.get(
        f"/teams/{team['team']['id']}/automation-rules", headers=team["headers"]
    ).json()
    assert [(r["is_enabled"], r["conditions"]["if_project_id"]) for r in rules] == [
        (False, None)
    ]
    # And it really is off: a new issue is not made urgent by it.
    issue = make_issue(client, team)
    assert issue["priority"] == "no_priority"


# --- progress (#61) ------------------------------------------------------
#
# An epic's progress is counted the way sub-issues count children (#13):
# cancelled work is neither done nor outstanding, so it leaves both numbers.


def progress(project):
    return project["completed_issue_count"], project["issue_count"]


def get_project(client, team, project):
    response = client.get(f"/projects/{project['id']}", headers=team["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def test_a_new_project_has_no_progress_to_report(client, team):
    assert progress(make_project(client, team)) == (0, 0)


def test_progress_counts_done_issues_and_leaves_out_cancelled_ones(client, team):
    project = make_project(client, team)
    statuses = team["status_ids"]
    make_issue(client, team, project_id=project["id"], status_id=statuses["Done"])
    make_issue(client, team, project_id=project["id"], status_id=statuses["Todo"])
    make_issue(
        client, team, project_id=project["id"], status_id=statuses["In Progress"]
    )
    make_issue(client, team, project_id=project["id"], status_id=statuses["Cancelled"])

    assert progress(get_project(client, team, project)) == (1, 3)


def test_an_epic_whose_remaining_work_was_cancelled_is_complete(client, team):
    project = make_project(client, team)
    statuses = team["status_ids"]
    make_issue(client, team, project_id=project["id"], status_id=statuses["Done"])
    make_issue(client, team, project_id=project["id"], status_id=statuses["Cancelled"])

    assert progress(get_project(client, team, project)) == (1, 1)


def test_an_epic_and_a_parent_agree_on_the_same_work(client, team):
    """Two groupings of identical issues must not report different progress."""
    project = make_project(client, team)
    parent = make_issue(client, team, title="Parent")
    for name in ("Done", "Todo", "Cancelled"):
        make_issue(
            client,
            team,
            project_id=project["id"],
            parent_id=parent["id"],
            status_id=team["status_ids"][name],
        )

    parent = client.get(f"/issues/{parent['id']}", headers=team["headers"]).json()
    assert progress(get_project(client, team, project)) == (
        parent["completed_child_count"],
        parent["child_count"],
    )


def test_removing_an_issue_takes_it_out_of_the_progress(client, team):
    project = make_project(client, team)
    kept = make_issue(client, team, project_id=project["id"])
    removed = make_issue(
        client, team, project_id=project["id"], status_id=team["status_ids"]["Done"]
    )
    assert progress(get_project(client, team, project)) == (1, 2)

    response = client.patch(
        f"/issues/{removed['id']}", json={"project_id": None}, headers=team["headers"]
    )
    assert response.status_code == 200, response.text
    assert response.json()["project_id"] is None
    assert progress(get_project(client, team, project)) == (0, 1)
    assert kept["project_id"] == project["id"]


def test_every_project_in_the_list_reports_its_own_progress(client, team):
    first = make_project(client, team, name="First")
    second = make_project(client, team, name="Second")
    make_project(client, team, name="Empty")
    make_issue(
        client, team, project_id=first["id"], status_id=team["status_ids"]["Done"]
    )
    make_issue(client, team, project_id=second["id"])
    make_issue(client, team, project_id=second["id"])
    make_issue(client, team)  # in no project at all

    listed = client.get(
        f"/teams/{team['team']['id']}/projects", headers=team["headers"]
    ).json()
    assert {row["name"]: progress(row) for row in listed} == {
        "First": (1, 1),
        "Second": (0, 2),
        "Empty": (0, 0),
    }


def test_writes_report_progress_too(client, team):
    """Every route that returns a project returns the same shape."""
    project = make_project(client, team)
    make_issue(client, team, project_id=project["id"])
    assert progress(update_project(client, team, project, name="Renamed")) == (0, 1)


def _queries_to_list_projects(client, team, session, project_count):
    for i in range(project_count):
        project = make_project(client, team, name=f"P{i}")
        make_issue(client, team, project_id=project["id"])

    counted = []
    engine = session.get_bind()

    def _record(conn, cursor, statement, *args):
        counted.append(statement)

    event.listen(engine, "before_cursor_execute", _record)
    try:
        response = client.get(
            f"/teams/{team['team']['id']}/projects", headers=team["headers"]
        )
    finally:
        event.remove(engine, "before_cursor_execute", _record)
    assert response.status_code == 200, response.text
    return len(counted)


def test_listing_projects_costs_one_progress_query_not_one_per_project(
    client, team, session
):
    few = _queries_to_list_projects(client, team, session, 1)
    many = _queries_to_list_projects(client, team, session, 6)
    assert few == many, (
        f"listing 1 project cost {few} queries and 7 cost {many}: progress is "
        "being counted per project again."
    )


# --- adding to and removing from an epic ------------------------------------


def test_an_issue_cannot_be_moved_into_another_teams_project(client, team, auth):
    other = auth(email="other@softtrack.dev")
    other_team = client.post(
        "/teams", json={"name": "Other", "key": "OTH"}, headers=other["headers"]
    ).json()
    foreign = client.post(
        f"/teams/{other_team['id']}/projects",
        json={"name": "Theirs"},
        headers=other["headers"],
    ).json()
    issue = make_issue(client, team)

    response = client.patch(
        f"/issues/{issue['id']}",
        json={"project_id": foreign["id"]},
        headers=team["headers"],
    )
    assert response.status_code == 400, response.text

    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "Filed elsewhere", "project_id": foreign["id"]},
        headers=team["headers"],
    )
    assert response.status_code == 400, response.text
