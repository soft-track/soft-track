"""Recording ticket history (issue #23).

This is the part that cannot be added retroactively: an event not written as
it happened is gone. So these tests are about what gets written, not about
what the charts do with it.
"""

from sqlmodel import select

from lib_softtrack.tables import TicketEvent, TicketEventField


def events(session, ticket_id, field=None):
    rows = session.exec(
        select(TicketEvent).where(TicketEvent.ticket_id == ticket_id)
    ).all()
    if field is not None:
        rows = [row for row in rows if row.field is field]
    return sorted(rows, key=lambda row: row.id)


def make_ticket(client, team, title="Work", **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/tickets",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_creating_a_ticket_records_its_opening_status(client, team, session):
    """Otherwise a ticket created straight into in_progress looks, to a
    cumulative flow diagram, like it was never anywhere."""
    ticket = make_ticket(client, team, status_id=team["status_ids"]["In Progress"])

    opening = events(session, ticket["id"], TicketEventField.status)
    assert len(opening) == 1
    assert opening[0].old_value is None
    # The category, not the column. History outlives the workflow that
    # produced it -- see `_status_category` in lib_softtrack/history.py.
    assert opening[0].new_value == "started"


def test_creation_records_the_estimate_and_sprint_when_given(client, team, session):
    sprint = client.post(
        f"/teams/{team['team']['id']}/sprints",
        json={"starts_at": "2026-01-01T00:00:00Z", "ends_at": "2026-01-14T00:00:00Z"},
        headers=team["headers"],
    ).json()
    ticket = make_ticket(client, team, estimate=5, sprint_id=sprint["id"])

    assert events(session, ticket["id"], TicketEventField.estimate)[0].new_value == "5"
    assert events(session, ticket["id"], TicketEventField.sprint)[0].new_value == str(
        sprint["id"]
    )


def test_creation_records_nothing_for_fields_left_unset(client, team, session):
    ticket = make_ticket(client, team)
    assert events(session, ticket["id"], TicketEventField.estimate) == []
    assert events(session, ticket["id"], TicketEventField.sprint) == []


def test_a_status_change_is_recorded_with_both_ends(client, team, session):
    ticket = make_ticket(client, team)
    client.patch(
        f"/tickets/{ticket['id']}",
        json={"status_id": team["status_ids"]["Done"]},
        headers=team["headers"],
    )

    change = events(session, ticket["id"], TicketEventField.status)[-1]
    assert (change.old_value, change.new_value) == ("backlog", "done")


def test_setting_a_field_to_what_it_already_was_records_nothing(client, team, session):
    """A PATCH that changes nothing is not a change. Counting it would put a
    phantom step in every cumulative flow diagram."""
    ticket = make_ticket(client, team, status_id=team["status_ids"]["Todo"])
    before = len(events(session, ticket["id"]))

    client.patch(
        f"/tickets/{ticket['id']}",
        json={"status_id": team["status_ids"]["Todo"]},
        headers=team["headers"],
    )
    assert len(events(session, ticket["id"])) == before


def test_untracked_fields_are_not_recorded(client, team, session):
    """Title and description churn would swamp the table and chart nothing."""
    ticket = make_ticket(client, team)
    before = len(events(session, ticket["id"]))

    client.patch(
        f"/tickets/{ticket['id']}",
        json={"title": "Renamed", "description": "New"},
        headers=team["headers"],
    )
    assert len(events(session, ticket["id"])) == before


def test_clearing_a_field_is_recorded_as_a_change_to_null(client, team, session):
    ticket = make_ticket(client, team, estimate=5)
    client.patch(
        f"/tickets/{ticket['id']}", json={"estimate": None}, headers=team["headers"]
    )

    change = events(session, ticket["id"], TicketEventField.estimate)[-1]
    assert (change.old_value, change.new_value) == ("5", None)


def test_carrying_a_ticket_between_sprints_is_recorded(client, team, session):
    """A report that cannot see carry-over shows work vanishing from one
    sprint and appearing in the next with no explanation."""
    first = client.post(
        f"/teams/{team['team']['id']}/sprints",
        json={"starts_at": "2026-01-01T00:00:00Z", "ends_at": "2026-01-14T00:00:00Z"},
        headers=team["headers"],
    ).json()
    second = client.post(
        f"/teams/{team['team']['id']}/sprints",
        json={"starts_at": "2026-01-15T00:00:00Z", "ends_at": "2026-01-28T00:00:00Z"},
        headers=team["headers"],
    ).json()
    ticket = make_ticket(client, team, sprint_id=first["id"])

    client.post(f"/sprints/{first['id']}/complete", headers=team["headers"])

    change = events(session, ticket["id"], TicketEventField.sprint)[-1]
    assert (change.old_value, change.new_value) == (str(first["id"]), str(second["id"]))


def test_deleting_a_sprint_records_its_tickets_leaving(client, team, session):
    sprint = client.post(
        f"/teams/{team['team']['id']}/sprints",
        json={"starts_at": "2026-01-01T00:00:00Z", "ends_at": "2026-01-14T00:00:00Z"},
        headers=team["headers"],
    ).json()
    ticket = make_ticket(client, team, sprint_id=sprint["id"])

    client.delete(f"/sprints/{sprint['id']}", headers=team["headers"])

    change = events(session, ticket["id"], TicketEventField.sprint)[-1]
    assert (change.old_value, change.new_value) == (str(sprint["id"]), None)


def test_events_carry_the_team_so_reports_can_filter_without_a_join(
    client, team, session
):
    ticket = make_ticket(client, team)
    assert all(
        event.team_id == team["team"]["id"] for event in events(session, ticket["id"])
    )


def test_deleting_a_ticket_takes_its_history_with_it(client, team, session):
    ticket = make_ticket(client, team)
    client.patch(
        f"/tickets/{ticket['id']}",
        json={"status_id": team["status_ids"]["Done"]},
        headers=team["headers"],
    )
    assert events(session, ticket["id"])

    assert (
        client.delete(f"/tickets/{ticket['id']}", headers=team["headers"]).status_code
        == 204
    )
    assert events(session, ticket["id"]) == []
