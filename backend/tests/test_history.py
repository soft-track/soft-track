"""Recording issue history (issue #23).

This is the part that cannot be added retroactively: an event not written as
it happened is gone. So these tests are about what gets written, not about
what the charts do with it.
"""

from lib_softtrack.tables import IssueEvent, IssueEventField


def events(session, issue_id, field=None):
    rows = session.query(IssueEvent).filter(IssueEvent.issue_id == issue_id).all()
    if field is not None:
        rows = [row for row in rows if row.field is field]
    return sorted(rows, key=lambda row: row.id)


def make_issue(client, team, title="Work", **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_creating_an_issue_records_its_opening_status(client, team, session):
    """Otherwise an issue created straight into in_progress looks, to a
    cumulative flow diagram, like it was never anywhere."""
    issue = make_issue(client, team, status="in_progress")

    opening = events(session, issue["id"], IssueEventField.status)
    assert len(opening) == 1
    assert opening[0].old_value is None
    assert opening[0].new_value == "in_progress"


def test_creation_records_the_estimate_and_cycle_when_given(client, team, session):
    cycle = client.post(
        f"/teams/{team['team']['id']}/cycles",
        json={"starts_at": "2026-01-01T00:00:00Z", "ends_at": "2026-01-14T00:00:00Z"},
        headers=team["headers"],
    ).json()
    issue = make_issue(client, team, estimate=5, cycle_id=cycle["id"])

    assert events(session, issue["id"], IssueEventField.estimate)[0].new_value == "5"
    assert events(session, issue["id"], IssueEventField.cycle)[0].new_value == str(
        cycle["id"]
    )


def test_creation_records_nothing_for_fields_left_unset(client, team, session):
    issue = make_issue(client, team)
    assert events(session, issue["id"], IssueEventField.estimate) == []
    assert events(session, issue["id"], IssueEventField.cycle) == []


def test_a_status_change_is_recorded_with_both_ends(client, team, session):
    issue = make_issue(client, team)
    client.patch(
        f"/issues/{issue['id']}", json={"status": "done"}, headers=team["headers"]
    )

    change = events(session, issue["id"], IssueEventField.status)[-1]
    assert (change.old_value, change.new_value) == ("backlog", "done")


def test_setting_a_field_to_what_it_already_was_records_nothing(client, team, session):
    """A PATCH that changes nothing is not a change. Counting it would put a
    phantom step in every cumulative flow diagram."""
    issue = make_issue(client, team, status="todo")
    before = len(events(session, issue["id"]))

    client.patch(
        f"/issues/{issue['id']}", json={"status": "todo"}, headers=team["headers"]
    )
    assert len(events(session, issue["id"])) == before


def test_untracked_fields_are_not_recorded(client, team, session):
    """Title and description churn would swamp the table and chart nothing."""
    issue = make_issue(client, team)
    before = len(events(session, issue["id"]))

    client.patch(
        f"/issues/{issue['id']}",
        json={"title": "Renamed", "description": "New"},
        headers=team["headers"],
    )
    assert len(events(session, issue["id"])) == before


def test_clearing_a_field_is_recorded_as_a_change_to_null(client, team, session):
    issue = make_issue(client, team, estimate=5)
    client.patch(
        f"/issues/{issue['id']}", json={"estimate": None}, headers=team["headers"]
    )

    change = events(session, issue["id"], IssueEventField.estimate)[-1]
    assert (change.old_value, change.new_value) == ("5", None)


def test_carrying_an_issue_between_cycles_is_recorded(client, team, session):
    """A report that cannot see carry-over shows work vanishing from one
    cycle and appearing in the next with no explanation."""
    first = client.post(
        f"/teams/{team['team']['id']}/cycles",
        json={"starts_at": "2026-01-01T00:00:00Z", "ends_at": "2026-01-14T00:00:00Z"},
        headers=team["headers"],
    ).json()
    second = client.post(
        f"/teams/{team['team']['id']}/cycles",
        json={"starts_at": "2026-01-15T00:00:00Z", "ends_at": "2026-01-28T00:00:00Z"},
        headers=team["headers"],
    ).json()
    issue = make_issue(client, team, cycle_id=first["id"])

    client.post(f"/cycles/{first['id']}/complete", headers=team["headers"])

    change = events(session, issue["id"], IssueEventField.cycle)[-1]
    assert (change.old_value, change.new_value) == (str(first["id"]), str(second["id"]))


def test_deleting_a_cycle_records_its_issues_leaving(client, team, session):
    cycle = client.post(
        f"/teams/{team['team']['id']}/cycles",
        json={"starts_at": "2026-01-01T00:00:00Z", "ends_at": "2026-01-14T00:00:00Z"},
        headers=team["headers"],
    ).json()
    issue = make_issue(client, team, cycle_id=cycle["id"])

    client.delete(f"/cycles/{cycle['id']}", headers=team["headers"])

    change = events(session, issue["id"], IssueEventField.cycle)[-1]
    assert (change.old_value, change.new_value) == (str(cycle["id"]), None)


def test_events_carry_the_team_so_reports_can_filter_without_a_join(
    client, team, session
):
    issue = make_issue(client, team)
    assert all(
        event.team_id == team["team"]["id"] for event in events(session, issue["id"])
    )


def test_deleting_an_issue_takes_its_history_with_it(client, team, session):
    issue = make_issue(client, team)
    client.patch(
        f"/issues/{issue['id']}", json={"status": "done"}, headers=team["headers"]
    )
    assert events(session, issue["id"])

    assert (
        client.delete(f"/issues/{issue['id']}", headers=team["headers"]).status_code
        == 204
    )
    assert events(session, issue["id"]) == []
