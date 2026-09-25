"""A project's progress, and filing issues into one (issue #61).

Progress is counted the way sub-issue progress is (#13): a cancelled issue is
in neither number. What these pin is that projects do not grow a second answer
to that question, and that the whole list is counted at once.
"""

from sqlalchemy import event


def make_project(client, team, name="Platform"):
    response = client.post(
        f"/teams/{team['team']['id']}/projects",
        json={"name": name},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def make_issue(client, team, title="Work", **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def progress(project):
    return project["completed_issue_count"], project["issue_count"]


def move(client, team, issue, status):
    response = client.patch(
        f"/issues/{issue['id']}",
        json={"status_id": team["status_ids"][status]},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text


def test_an_empty_project_is_zero_of_zero(client, team):
    assert progress(make_project(client, team)) == (0, 0)


def test_progress_counts_done_and_leaves_cancelled_out_of_both(client, team):
    project = make_project(client, team)
    done, cancelled, _open, _started = (
        make_issue(client, team, title, project_id=project["id"])
        for title in ("Done", "Cancelled", "Open", "Started")
    )
    move(client, team, done, "Done")
    move(client, team, cancelled, "Cancelled")
    move(client, team, _started, "In Progress")
    # Not in the project, so in neither number.
    make_issue(client, team, "Elsewhere")

    read = client.get(f"/projects/{project['id']}", headers=team["headers"]).json()
    assert progress(read) == (1, 3)


def test_every_project_in_the_list_carries_its_own_progress(client, team):
    first = make_project(client, team, "First")
    second = make_project(client, team, "Second")
    make_project(client, team, "Empty")
    move(client, team, make_issue(client, team, project_id=first["id"]), "Done")
    make_issue(client, team, project_id=first["id"])
    make_issue(client, team, project_id=second["id"])

    listed = client.get(
        f"/teams/{team['team']['id']}/projects", headers=team["headers"]
    ).json()
    assert {p["name"]: progress(p) for p in listed} == {
        "First": (1, 2),
        "Second": (0, 1),
        "Empty": (0, 0),
    }


def test_a_write_answers_with_progress_too(client, team):
    project = make_project(client, team)
    make_issue(client, team, project_id=project["id"])

    response = client.patch(
        f"/projects/{project['id']}", json={"name": "Renamed"}, headers=team["headers"]
    )
    assert progress(response.json()) == (0, 1)


def test_the_list_costs_the_same_however_many_projects_there_are(client, team, session):
    """One grouped query for the whole list, not one per project."""
    url = f"/teams/{team['team']['id']}/projects"

    def queries_to_list() -> int:
        counted = []
        engine = session.get_bind()

        def record(*_args):
            counted.append(1)

        event.listen(engine, "before_cursor_execute", record)
        try:
            assert client.get(url, headers=team["headers"]).status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", record)
        return len(counted)

    project = make_project(client, team, "One")
    make_issue(client, team, project_id=project["id"])
    with_one = queries_to_list()

    for n in range(5):
        more = make_project(client, team, f"More {n}")
        make_issue(client, team, project_id=more["id"])
    assert queries_to_list() == with_one


# --- filing issues into a project ----------------------------------------------


def test_an_issue_moves_into_and_out_of_a_project(client, team):
    project = make_project(client, team)
    issue = make_issue(client, team)

    moved = client.patch(
        f"/issues/{issue['id']}",
        json={"project_id": project["id"]},
        headers=team["headers"],
    )
    assert moved.json()["project_id"] == project["id"]
    read = client.get(f"/projects/{project['id']}", headers=team["headers"]).json()
    assert progress(read) == (0, 1)

    removed = client.patch(
        f"/issues/{issue['id']}", json={"project_id": None}, headers=team["headers"]
    )
    assert removed.json()["project_id"] is None
    read = client.get(f"/projects/{project['id']}", headers=team["headers"]).json()
    assert progress(read) == (0, 0)


def _other_teams_project(client, auth):
    outsider = auth(email="other@softtrack.dev", full_name="Other Team")
    team = client.post(
        "/teams", json={"name": "Design", "key": "DES"}, headers=outsider["headers"]
    ).json()
    response = client.post(
        f"/teams/{team['id']}/projects",
        json={"name": "Theirs"},
        headers=outsider["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_an_issue_cannot_be_moved_into_another_teams_project(client, team, auth):
    """The foreign key is satisfied, so only this check stops it."""
    theirs = _other_teams_project(client, auth)
    issue = make_issue(client, team)

    response = client.patch(
        f"/issues/{issue['id']}",
        json={"project_id": theirs["id"]},
        headers=team["headers"],
    )
    assert response.status_code == 400
    after = client.get(f"/issues/{issue['id']}", headers=team["headers"]).json()
    assert after["project_id"] is None


def test_an_issue_cannot_be_filed_into_another_teams_project(client, team, auth):
    theirs = _other_teams_project(client, auth)
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "Stray", "project_id": theirs["id"]},
        headers=team["headers"],
    )
    assert response.status_code == 400
