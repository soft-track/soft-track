"""Recording which project an issue moved into, and the burnup read from it
(issue #64).

The burnup is replayed from `issueevent` like every other report, so most of
what can go wrong is upstream of it: a path that changes an issue's project
without writing a row is a path the chart silently cannot see.
"""

from datetime import datetime, timedelta, timezone

from sqlmodel import select

from lib_softtrack.tables import IssueEvent, IssueEventField


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


def patch(client, team, issue, **fields):
    response = client.patch(
        f"/issues/{issue['id']}", json=fields, headers=team["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def project_events(session, issue):
    session.expire_all()
    return [
        (event.old_value, event.new_value)
        for event in session.exec(
            select(IssueEvent)
            .where(
                IssueEvent.issue_id == issue["id"],
                IssueEvent.field == IssueEventField.project,
            )
            .order_by(IssueEvent.id)
        ).all()
    ]


def burnup(client, team, project, expect=200):
    response = client.get(f"/projects/{project['id']}/burnup", headers=team["headers"])
    assert response.status_code == expect, response.text
    return response.json()


def backdate(session, issue, days):
    """Move an issue's history back in time, so a test can span several days."""
    moment = datetime.now(timezone.utc) - timedelta(days=days)
    query = select(IssueEvent).where(IssueEvent.issue_id == issue["id"])
    for event in session.exec(query).all():
        event.created_at = moment
        session.add(event)
    session.commit()


# --- recording ---------------------------------------------------------------


def test_filing_an_issue_into_a_project_records_it(client, team, session):
    project = make_project(client, team)
    issue = make_issue(client, team, project_id=project["id"])
    assert project_events(session, issue) == [(None, str(project["id"]))]


def test_an_issue_filed_into_no_project_records_nothing(client, team, session):
    """Null is the absence of a project, not a value worth a row -- the same
    rule the other tracked fields follow on creation."""
    issue = make_issue(client, team)
    assert project_events(session, issue) == []


def test_moving_between_projects_records_both_ends(client, team, session):
    first = make_project(client, team, "First")
    second = make_project(client, team, "Second")
    issue = make_issue(client, team, project_id=first["id"])

    patch(client, team, issue, project_id=second["id"])
    patch(client, team, issue, project_id=None)
    # Setting it to what it already is is not a change.
    patch(client, team, issue, project_id=None)

    assert project_events(session, issue) == [
        (None, str(first["id"])),
        (str(first["id"]), str(second["id"])),
        (str(second["id"]), None),
    ]


def test_a_bulk_move_records_every_issue(client, team, session):
    project = make_project(client, team)
    issues = [make_issue(client, team, f"Bulk {n}") for n in range(2)]
    response = client.post(
        f"/teams/{team['team']['id']}/issues/bulk-update",
        json={
            "issue_ids": [issue["id"] for issue in issues],
            "changes": {"project_id": project["id"]},
        },
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    for issue in issues:
        assert project_events(session, issue) == [(None, str(project["id"]))]


def test_deleting_a_project_records_its_issues_leaving(client, team, session):
    """Otherwise the history would have them in a deleted project for ever."""
    project = make_project(client, team)
    issue = make_issue(client, team, project_id=project["id"])
    client.delete(f"/projects/{project['id']}", headers=team["headers"])
    assert project_events(session, issue)[-1] == (str(project["id"]), None)


# --- the burnup --------------------------------------------------------------


def test_a_project_with_no_history_has_no_chart(client, team):
    """Not a flat line from its creation date: nothing was recorded to draw."""
    chart = burnup(client, team, make_project(client, team))
    assert chart["started_on"] is None
    assert chart["points"] == []


def test_scope_and_completed_work_in_issues_and_points(client, team):
    project = make_project(client, team)
    in_project = {"project_id": project["id"]}
    done = make_issue(client, team, "Done", estimate=3, **in_project)
    make_issue(client, team, "Open", estimate=5, **in_project)
    make_issue(client, team, "Unsized", **in_project)
    cancelled = make_issue(client, team, "Cancelled", estimate=8, **in_project)
    make_issue(client, team, "Elsewhere", estimate=2)
    patch(client, team, done, status_id=team["status_ids"]["Done"])
    patch(client, team, cancelled, status_id=team["status_ids"]["Cancelled"])

    [today] = burnup(client, team, project)["points"]
    assert today == {
        "day": today["day"],
        # Cancelled is neither scope nor done, as with progress (#13).
        "scope_issues": 3,
        "completed_issues": 1,
        # The unsized issue is not summed in as zero...
        "scope_points": 8,
        "completed_points": 3,
        # ...it is counted, so the 8 reads as a floor.
        "unestimated_issues": 1,
    }


def test_the_chart_starts_at_the_first_recorded_event_and_shows_late_scope(
    client, team, session
):
    project = make_project(client, team)
    early = make_issue(client, team, "Early", estimate=2, project_id=project["id"])
    backdate(session, early, days=3)
    make_issue(client, team, "Late", estimate=5, project_id=project["id"])

    chart = burnup(client, team, project)
    points = chart["points"]
    assert chart["started_on"] == points[0]["day"]
    assert len(points) == 4
    # Flat at the early scope, then the day scope was added.
    assert [p["scope_points"] for p in points] == [2, 2, 2, 7]
    assert [p["scope_issues"] for p in points] == [1, 1, 1, 2]


def test_an_issue_moved_out_stops_counting_from_that_day(client, team, session):
    project = make_project(client, team)
    other = make_project(client, team, "Other")
    issue = make_issue(client, team, estimate=3, project_id=project["id"])
    backdate(session, issue, days=2)
    patch(client, team, issue, project_id=other["id"])

    points = burnup(client, team, project)["points"]
    assert [p["scope_points"] for p in points] == [3, 3, 0]


def test_completion_is_replayed_by_day_too(client, team, session):
    project = make_project(client, team)
    issue = make_issue(client, team, estimate=5, project_id=project["id"])
    backdate(session, issue, days=1)
    patch(client, team, issue, status_id=team["status_ids"]["Done"])

    points = burnup(client, team, project)["points"]
    assert [(p["scope_points"], p["completed_points"]) for p in points] == [
        (5, 0),
        (5, 5),
    ]


def test_only_team_members_see_a_burnup(client, team, auth):
    project = make_project(client, team)
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    response = client.get(
        f"/projects/{project['id']}/burnup", headers=outsider["headers"]
    )
    assert response.status_code == 403


def test_a_missing_project_is_a_404(client, team):
    response = client.get("/projects/999999/burnup", headers=team["headers"])
    assert response.status_code == 404
