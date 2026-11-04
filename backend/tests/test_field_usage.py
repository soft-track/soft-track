"""How much each field is used (#334): counts for the Fields settings page.

Out of the team's open tickets of the types a field shows on: how many have
a value, by option, by person or ticked, and when a ticket was last given
one. Counts only -- the page names no tickets.
"""

from datetime import datetime

import pytest
from sqlalchemy import event
from sqlmodel import select

from lib_softtrack import custom_fields as custom_fields_service
from lib_softtrack.tables import CustomFieldValue, TicketEvent, User
from tests.test_custom_fields import add_field, file_ticket, join, patch
from tests.test_external_accounts import join_from_outside


def usage(client, actor, team_id, expect=200):
    response = client.get(
        f"/teams/{team_id}/custom-fields/usage", headers=actor["headers"]
    )
    assert response.status_code == expect, response.text
    return response.json()


def usage_of(client, actor, team_id, field):
    """The counts for one field, by the field as `add_field` returned it."""
    return next(
        row for row in usage(client, actor, team_id) if row["field_id"] == field["id"]
    )


def options(row):
    return {option["id"]: option["count"] for option in row["options"]}


def trash(client, actor, ticket):
    response = client.delete(f"/tickets/{ticket['id']}", headers=actor["headers"])
    assert response.status_code == 204, response.text


@pytest.fixture
def eng(client, team):
    team_id = team["team"]["id"]
    environment = add_field(
        client,
        team,
        team_id,
        name="Environment",
        kind="select",
        options=[
            {"name": "production"},
            {"name": "staging"},
            {"name": "dev"},
            {"name": "qa"},
        ],
        applies_to=["bug"],
    )
    return {**team, "team_id": team_id, "environment": environment}


@pytest.fixture
def people(client, team, auth):
    """Mei and Ravi, members of ENG."""
    mei = auth(email="mei@softtrack.dev", full_name="Mei Tanaka")
    ravi = auth(email="ravi@softtrack.dev", full_name="Ravi Patel")
    join(client, team, mei)
    join(client, team, ravi)
    return {"mei": mei, "ravi": ravi}


# --- what is counted ---------------------------------------------------------


def test_a_field_counts_only_the_open_tickets_of_the_types_it_shows_on(client, eng):
    team_id = eng["team_id"]
    for environment in ("production", "staging", None):
        file_ticket(
            client,
            eng,
            team_id,
            type="bug",
            custom_fields={"environment": environment} if environment else {},
        )
    # A task and a story are not asked about environments...
    file_ticket(client, eng, team_id, type="task")
    file_ticket(client, eng, team_id, type="story")
    # ...and a value kept from when a task was a bug is not one it is asked.
    was_a_bug = file_ticket(
        client, eng, team_id, type="bug", custom_fields={"environment": "dev"}
    )
    patch(client, eng, was_a_bug["id"], type="task")

    row = usage_of(client, eng, team_id, eng["environment"])
    assert (row["open_tickets"], row["with_value"]) == (3, 2)
    assert options(row) == {"production": 1, "staging": 1, "dev": 0, "qa": 0}


def test_a_field_on_every_type_counts_every_open_ticket(client, eng):
    team_id = eng["team_id"]
    notes = add_field(client, eng, team_id, name="Notes", kind="text")
    file_ticket(client, eng, team_id, type="bug", custom_fields={"notes": "Flaky"})
    file_ticket(client, eng, team_id, type="task")
    file_ticket(client, eng, team_id, type="story", custom_fields={"notes": "Ask"})

    row = usage_of(client, eng, team_id, notes)
    assert (row["open_tickets"], row["with_value"]) == (3, 2)
    # Nothing typed is broken down: there or not is the count.
    assert (row["options"], row["people"]) == ([], [])


def test_done_and_cancelled_tickets_are_not_counted(client, eng):
    team_id = eng["team_id"]
    tickets = [
        file_ticket(
            client, eng, team_id, type="bug", custom_fields={"environment": "dev"}
        )
        for _ in range(4)
    ]
    patch(client, eng, tickets[0]["id"], status_id=eng["status_ids"]["Done"])
    patch(client, eng, tickets[1]["id"], status_id=eng["status_ids"]["Cancelled"])
    # Still open, whatever it is called: backlog and in progress both count.
    patch(client, eng, tickets[2]["id"], status_id=eng["status_ids"]["In Progress"])

    row = usage_of(client, eng, team_id, eng["environment"])
    assert (row["open_tickets"], row["with_value"]) == (2, 2)
    assert options(row)["dev"] == 2


def test_a_ticket_in_the_trash_is_not_counted(client, eng):
    team_id = eng["team_id"]
    file_ticket(client, eng, team_id, type="bug", custom_fields={"environment": "qa"})
    binned = file_ticket(
        client, eng, team_id, type="bug", custom_fields={"environment": "qa"}
    )
    trash(client, eng, binned)

    row = usage_of(client, eng, team_id, eng["environment"])
    assert (row["open_tickets"], row["with_value"]) == (1, 1)
    assert options(row)["qa"] == 1


# --- broken down -----------------------------------------------------------------


def test_a_select_counts_every_option_and_one_nobody_uses_is_nought(client, eng):
    team_id = eng["team_id"]
    for environment in ("production",) * 3 + ("staging",) * 2 + ("dev",):
        file_ticket(
            client, eng, team_id, type="bug", custom_fields={"environment": environment}
        )
    file_ticket(client, eng, team_id, type="bug")

    row = usage_of(client, eng, team_id, eng["environment"])
    # Every option, in the field's own order, the unused one included.
    assert row["options"] == [
        {"id": "production", "count": 3},
        {"id": "staging", "count": 2},
        {"id": "dev", "count": 1},
        {"id": "qa", "count": 0},
    ]
    assert (row["open_tickets"], row["with_value"]) == (7, 6)


def test_a_multi_select_counts_a_ticket_once_for_each_option(client, eng):
    team_id = eng["team_id"]
    platforms = add_field(
        client,
        eng,
        team_id,
        name="Platforms",
        kind="multi_select",
        options=[{"name": "iOS"}, {"name": "Android"}, {"name": "Web"}],
    )
    for chosen in (["ios", "web"], ["web", "ios"], ["web"], None):
        file_ticket(
            client,
            eng,
            team_id,
            custom_fields={"platforms": chosen} if chosen else {},
        )

    row = usage_of(client, eng, team_id, platforms)
    assert options(row) == {"ios": 2, "android": 0, "web": 3}
    assert (row["open_tickets"], row["with_value"]) == (4, 3)


def test_a_user_field_counts_per_person_most_first(client, eng, people):
    team_id = eng["team_id"]
    qa = add_field(client, eng, team_id, name="QA assignee", kind="user")
    mei, ravi = people["mei"]["user"]["id"], people["ravi"]["user"]["id"]
    for person in (ravi, mei, mei, eng["user"]["id"], None):
        file_ticket(
            client,
            eng,
            team_id,
            custom_fields={"qa_assignee": person} if person else {},
        )

    row = usage_of(client, eng, team_id, qa)
    # Most first; a tie by name.
    assert [(p["user"]["full_name"], p["count"]) for p in row["people"]] == [
        ("Mei Tanaka", 2),
        ("Demo User", 1),
        ("Ravi Patel", 1),
    ]
    # Nobody is the rest, not a row.
    assert (row["open_tickets"], row["with_value"]) == (5, 4)
    assert row["options"] == []


def test_a_checkbox_counts_the_ticked_ones(client, eng):
    team_id = eng["team_id"]
    notes = add_field(
        client,
        eng,
        team_id,
        name="Release notes written",
        kind="checkbox",
        applies_to=["story"],
    )
    stories = [file_ticket(client, eng, team_id, type="story") for _ in range(3)]
    patch(client, eng, stories[0]["id"], custom_fields={"release_notes_written": True})
    patch(client, eng, stories[1]["id"], custom_fields={"release_notes_written": True})
    # Unticking clears it.
    patch(client, eng, stories[1]["id"], custom_fields={"release_notes_written": False})

    row = usage_of(client, eng, team_id, notes)
    assert (row["open_tickets"], row["with_value"]) == (3, 1)


# --- when it was last set ----------------------------------------------------------


def test_last_set_is_when_a_ticket_was_last_given_a_value(client, eng, session):
    team_id = eng["team_id"]
    field_id = eng["environment"]["id"]
    assert usage_of(client, eng, team_id, eng["environment"])["last_set_at"] is None

    filed = file_ticket(
        client, eng, team_id, type="bug", custom_fields={"environment": "dev"}
    )
    changed = file_ticket(client, eng, team_id, type="bug")
    patch(client, eng, changed["id"], custom_fields={"environment": "staging"})
    patch(client, eng, changed["id"], custom_fields={"environment": None})
    # Closed tickets count here: this is when, not how many.
    patch(client, eng, filed["id"], status_id=eng["status_ids"]["Done"])

    # Filing with a value writes no history, so the value itself says when.
    session.exec(
        select(CustomFieldValue).where(CustomFieldValue.ticket_id == filed["id"])
    ).one().updated_at = datetime(2026, 1, 5)
    set_, cleared = session.exec(
        select(TicketEvent)
        .where(TicketEvent.custom_field_id == field_id)
        .order_by(TicketEvent.id)
    ).all()
    set_.created_at = datetime(2026, 2, 5)
    # Clearing it is a change, and not a ticket being given a value.
    cleared.created_at = datetime(2026, 3, 5)
    session.commit()
    row = usage_of(client, eng, team_id, eng["environment"])
    assert row["last_set_at"] == "2026-02-05T00:00:00"

    session.exec(
        select(CustomFieldValue).where(CustomFieldValue.ticket_id == filed["id"])
    ).one().updated_at = datetime(2026, 4, 5)
    session.commit()
    row = usage_of(client, eng, team_id, eng["environment"])
    assert row["last_set_at"] == "2026-04-05T00:00:00"


def test_a_value_in_the_trash_was_not_last_set(client, eng):
    team_id = eng["team_id"]
    binned = file_ticket(
        client, eng, team_id, type="bug", custom_fields={"environment": "dev"}
    )
    patch(client, eng, binned["id"], custom_fields={"environment": "qa"})
    assert usage_of(client, eng, team_id, eng["environment"])["last_set_at"]

    trash(client, eng, binned)
    assert usage_of(client, eng, team_id, eng["environment"])["last_set_at"] is None


# --- whose ---------------------------------------------------------------------


def test_a_team_counts_its_own_fields_and_tickets(client, eng, auth):
    other = auth(email="ops@softtrack.dev", full_name="Ops Lead")
    ops = client.post(
        "/teams", json={"name": "Operations", "key": "OPS"}, headers=other["headers"]
    ).json()
    theirs = add_field(
        client,
        other,
        ops["id"],
        name="Environment",
        kind="select",
        options=[{"name": "dev"}],
        applies_to=["bug"],
    )
    file_ticket(
        client, other, ops["id"], type="bug", custom_fields={"environment": "dev"}
    )
    file_ticket(
        client, eng, eng["team_id"], type="bug", custom_fields={"environment": "qa"}
    )

    ours = usage(client, eng, eng["team_id"])
    assert [row["field_id"] for row in ours] == [eng["environment"]["id"]]
    assert (ours[0]["open_tickets"], options(ours[0])["dev"]) == (1, 0)
    assert usage_of(client, other, ops["id"], theirs)["with_value"] == 1
    # And a team's counts are its members' alone.
    assert usage(client, other, eng["team_id"], expect=403)["code"] == (
        "not_team_member"
    )
    assert usage(client, eng, 9999, expect=404)["code"] == "team_not_found"


def test_members_and_guests_read_it_as_they_read_the_fields(client, eng, people, auth):
    file_ticket(
        client, eng, eng["team_id"], type="bug", custom_fields={"environment": "dev"}
    )
    guest = auth(email="guest@softtrack.dev", full_name="Gus Guest")
    join(client, eng, guest, role="guest")
    for reader in (people["mei"], guest):
        row = usage_of(client, reader, eng["team_id"], eng["environment"])
        assert (row["open_tickets"], row["with_value"]) == (1, 1)


def test_an_account_from_outside_counts_only_the_tickets_of_its_epics(client, eng):
    team_id = eng["team_id"]
    h = eng["headers"]
    portal = client.post(
        f"/teams/{team_id}/projects", json={"name": "Customer portal"}, headers=h
    ).json()
    file_ticket(
        client,
        eng,
        team_id,
        type="bug",
        project_id=portal["id"],
        custom_fields={"environment": "production"},
    )
    for _ in range(3):
        file_ticket(
            client, eng, team_id, type="bug", custom_fields={"environment": "dev"}
        )
    carlos = join_from_outside(
        client,
        eng,
        "carlos@acme-retail.com",
        "Carlos Rivera",
        [portal["id"]],
    )

    row = usage_of(client, carlos, team_id, eng["environment"])
    assert (row["open_tickets"], row["with_value"]) == (1, 1)
    assert options(row) == {"production": 1, "staging": 0, "dev": 0, "qa": 0}
    assert usage_of(client, eng, team_id, eng["environment"])["open_tickets"] == 4


# --- what it costs -----------------------------------------------------------------


def _queries_for_usage(session, actor_id, team_id) -> int:
    session.expire_all()
    actor = session.get(User, actor_id)  # loaded before counting starts
    engine = session.get_bind()
    counted: list[str] = []

    def record(conn, cursor, statement, *args):
        counted.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        custom_fields_service.field_usage(session, actor, team_id)
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return len(counted)


def test_the_page_is_counted_in_the_same_queries_however_many_fields(
    client, eng, people, session
):
    """The property that matters, as tests/test_query_counts.py has it for the
    ticket list: the cost does not grow with the number of fields."""
    team_id = eng["team_id"]
    add_field(client, eng, team_id, name="QA assignee", kind="user")
    file_ticket(
        client,
        eng,
        team_id,
        type="bug",
        custom_fields={"environment": "dev", "qa_assignee": eng["user"]["id"]},
    )
    few = _queries_for_usage(session, eng["user"]["id"], team_id)

    mei = people["mei"]["user"]["id"]
    for number in range(4):
        add_field(client, eng, team_id, name=f"Reviewer {number}", kind="user")
        add_field(
            client,
            eng,
            team_id,
            name=f"Platforms {number}",
            kind="multi_select",
            options=[{"name": "iOS"}, {"name": "Web"}],
        )
        add_field(client, eng, team_id, name=f"Signed off {number}", kind="checkbox")
        add_field(client, eng, team_id, name=f"Notes {number}", kind="text")
        file_ticket(
            client,
            eng,
            team_id,
            custom_fields={
                f"reviewer_{number}": mei,
                f"platforms_{number}": ["web"],
                f"signed_off_{number}": True,
                f"notes_{number}": "Looked at",
            },
        )
    many = _queries_for_usage(session, eng["user"]["id"], team_id)

    assert len(usage(client, eng, team_id)) == 18
    assert few == many, (
        f"the page cost {few} queries for 2 fields and {many} for 18. "
        "Something is counting one field at a time."
    )
