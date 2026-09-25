"""Due dates on issues (issue #87): setting one, filtering on it, and history.

Dates in the filter tests are fixed, with `today` passed as the client
would pass its own, so "this week" is testable on any day the suite runs.
"""

import pytest
from sqlmodel import select

from lib_softtrack.tables import IssueEvent, IssueEventField

#: A Wednesday. Its week runs to Sunday the 27th.
WEDNESDAY = "2026-09-23"


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


def listed(client, team, **params):
    response = client.get(
        f"/teams/{team['team']['id']}/issues",
        params=params,
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return sorted(issue["title"] for issue in response.json()["items"])


def test_an_issue_can_be_created_with_a_due_date(client, team):
    issue = make_issue(client, team, due_date="2026-10-01")
    assert issue["due_date"] == "2026-10-01"
    read = client.get(f"/issues/{issue['id']}", headers=team["headers"]).json()
    assert read["due_date"] == "2026-10-01"


def test_a_due_date_is_optional(client, team):
    assert make_issue(client, team)["due_date"] is None


def test_a_due_date_can_be_moved_and_cleared(client, team):
    issue = make_issue(client, team, due_date="2026-10-01")
    assert patch(client, team, issue, due_date="2026-10-08")["due_date"] == "2026-10-08"
    assert patch(client, team, issue, due_date=None)["due_date"] is None


def test_an_update_that_does_not_mention_it_leaves_it_alone(client, team):
    issue = make_issue(client, team, due_date="2026-10-01")
    assert patch(client, team, issue, title="Renamed")["due_date"] == "2026-10-01"


def test_changes_are_recorded_in_the_history(client, team, session):
    issue = make_issue(client, team, due_date="2026-10-01")
    patch(client, team, issue, due_date="2026-10-08")
    patch(client, team, issue, due_date=None)

    session.expire_all()
    rows = session.exec(
        select(IssueEvent)
        .where(
            IssueEvent.issue_id == issue["id"],
            IssueEvent.field == IssueEventField.due_date,
        )
        .order_by(IssueEvent.id)
    ).all()
    assert [(row.old_value, row.new_value, row.opening) for row in rows] == [
        (None, "2026-10-01", True),
        ("2026-10-01", "2026-10-08", False),
        ("2026-10-08", None, False),
    ]
    # And the issue's own Activity feed shows the two changes.
    fields = [
        e["field"]
        for e in client.get(
            f"/issues/{issue['id']}/events", headers=team["headers"]
        ).json()
    ]
    assert fields == ["due_date", "due_date"]


def test_a_date_that_is_not_one_is_refused(client, team):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "Bad", "due_date": "next friday"},
        headers=team["headers"],
    )
    assert response.status_code == 422


# --- filtering ----------------------------------------------------------------


@pytest.fixture
def calendar(client, team):
    """Issues due around WEDNESDAY, some finished, and one with no date."""
    done, cancelled = team["status_ids"]["Done"], team["status_ids"]["Cancelled"]
    make_issue(client, team, "Last week, open", due_date="2026-09-16")
    make_issue(client, team, "Yesterday, open", due_date="2026-09-22")
    make_issue(client, team, "Yesterday, done", due_date="2026-09-22", status_id=done)
    make_issue(
        client, team, "Monday, cancelled", due_date="2026-09-21", status_id=cancelled
    )
    make_issue(client, team, "Today", due_date=WEDNESDAY)
    make_issue(client, team, "Sunday", due_date="2026-09-27")
    make_issue(client, team, "Next Monday", due_date="2026-09-28")
    make_issue(client, team, "Undated")


def test_overdue_is_past_its_date_and_still_open(client, team, calendar):
    assert listed(client, team, due="overdue", today=WEDNESDAY) == [
        "Last week, open",
        "Yesterday, open",
    ]


def test_due_this_week_runs_from_today_to_sunday(client, team, calendar):
    """Today and Sunday included; yesterday is overdue, not "this week";
    Monday is next week."""
    assert listed(client, team, due="this_week", today=WEDNESDAY) == [
        "Sunday",
        "Today",
    ]


def test_on_a_sunday_this_week_is_just_today(client, team, calendar):
    assert listed(client, team, due="this_week", today="2026-09-27") == ["Sunday"]


def test_no_due_date(client, team, calendar):
    assert listed(client, team, due="none") == ["Undated"]


def test_the_due_filter_composes_with_the_others(client, team, calendar):
    assert listed(client, team, due="overdue", today=WEDNESDAY, priority="urgent") == []


def test_an_unknown_due_filter_is_refused(client, team):
    response = client.get(
        f"/teams/{team['team']['id']}/issues",
        params={"due": "someday"},
        headers=team["headers"],
    )
    assert response.status_code == 422


def test_a_saved_view_keeps_the_due_filter(client, team):
    response = client.post(
        f"/teams/{team['team']['id']}/views",
        json={"name": "Late", "filters": {"due": "overdue"}},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    assert response.json()["filters"]["due"] == "overdue"


# --- a date range, for the calendar (#105) ------------------------------------


def test_a_due_date_range_is_inclusive_at_both_ends(client, team):
    team_id = team["team"]["id"]
    for day in ("2026-08-31", "2026-09-01", "2026-09-15", "2026-09-30", "2026-10-01"):
        client.post(
            f"/teams/{team_id}/issues",
            json={"title": day, "due_date": day},
            headers=team["headers"],
        )
    client.post(
        f"/teams/{team_id}/issues", json={"title": "undated"}, headers=team["headers"]
    )

    def titles(**params):
        response = client.get(
            f"/teams/{team_id}/issues", params=params, headers=team["headers"]
        )
        assert response.status_code == 200, response.text
        return sorted(issue["title"] for issue in response.json()["items"])

    assert titles(due_from="2026-09-01", due_to="2026-09-30") == [
        "2026-09-01",
        "2026-09-15",
        "2026-09-30",
    ]
    assert titles(due_from="2026-09-30") == ["2026-09-30", "2026-10-01"]
    assert titles(due_to="2026-08-31") == ["2026-08-31"]
