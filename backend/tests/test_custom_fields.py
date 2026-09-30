"""Fields a team defines for its own tickets (#117)."""

import csv
import io
import json

import pytest
from sqlmodel import select

from app_softtrack.tickets import CSV_COLUMNS
from lib_softtrack import outbound
from lib_softtrack.custom_fields import RESERVED_KEYS
from lib_softtrack.tables import (
    CustomFieldValue,
    Notification,
    TicketEvent,
    TicketWatch,
)
from tests.conftest import delete_for_good


def join(client, team, person, role="member"):
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": person["user"]["email"], "role": role},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text


def add_field(client, actor, team_id, expect=200, **body):
    response = client.post(
        f"/teams/{team_id}/custom-fields", json=body, headers=actor["headers"]
    )
    assert response.status_code == expect, response.text
    return response.json()


def fields_of(client, actor, team_id):
    response = client.get(f"/teams/{team_id}/custom-fields", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def change_field(client, actor, field_id, expect=200, **body):
    response = client.patch(
        f"/custom-fields/{field_id}", json=body, headers=actor["headers"]
    )
    assert response.status_code == expect, response.text
    return response.json()


def file_ticket(client, actor, team_id, expect=200, **body):
    response = client.post(
        f"/teams/{team_id}/tickets",
        json={"title": "Export drops the last row", **body},
        headers=actor["headers"],
    )
    assert response.status_code == expect, response.text
    return response.json()


def patch(client, actor, ticket_id, expect=200, **body):
    response = client.patch(
        f"/tickets/{ticket_id}", json=body, headers=actor["headers"]
    )
    assert response.status_code == expect, response.text
    return response.json()


@pytest.fixture
def people(client, team, auth):
    """Priya and Daniel, members of ENG; Olga, on no team of ours."""
    priya = auth(email="priya@softtrack.dev", full_name="Priya Raman")
    daniel = auth(email="daniel@softtrack.dev", full_name="Daniel Okafor")
    olga = auth(email="olga@softtrack.dev", full_name="Olga Outsider")
    join(client, team, priya)
    join(client, team, daniel)
    return {"priya": priya, "daniel": daniel, "olga": olga}


@pytest.fixture
def eng(client, team):
    """ENG with the fields the design shows."""
    team_id = team["team"]["id"]
    fields = {
        "qa": add_field(
            client, team, team_id, name="QA assignee", kind="user", required=True
        ),
        "reviewer": add_field(client, team, team_id, name="Reviewer", kind="user"),
        "environment": add_field(
            client,
            team,
            team_id,
            name="Environment",
            kind="select",
            options=[{"name": "Production"}, {"name": "Staging"}, {"name": "Dev"}],
            applies_to=["bug"],
        ),
        "sentry": add_field(
            client, team, team_id, name="Sentry URL", kind="url", applies_to=["bug"]
        ),
        "customer": add_field(
            client,
            team,
            team_id,
            name="Customer",
            kind="text",
            applies_to=["bug", "story"],
        ),
        "release": add_field(client, team, team_id, name="Target release", kind="date"),
    }
    return {**team, "team_id": team_id, "fields": fields}


# --- defining them --------------------------------------------------------------


def test_a_field_gets_a_key_from_its_name_and_goes_last(client, eng):
    listed = fields_of(client, eng, eng["team_id"])
    assert [f["key"] for f in listed] == [
        "qa_assignee",
        "reviewer",
        "environment",
        "sentry_url",
        "customer",
        "target_release",
    ]
    assert [f["position"] for f in listed] == [0, 1, 2, 3, 4, 5]
    environment = eng["fields"]["environment"]
    assert environment["options"] == [
        {"id": "production", "name": "Production"},
        {"id": "staging", "name": "Staging"},
        {"id": "dev", "name": "Dev"},
    ]
    assert environment["applies_to"] == ["bug"]
    assert environment["archived_at"] is None


def test_a_derived_key_steps_around_one_that_is_taken(client, team):
    team_id = team["team"]["id"]
    add_field(client, team, team_id, name="Owner", key="owner_2", kind="text")
    add_field(client, team, team_id, name="Old owner", key="owner", kind="text")
    assert add_field(client, team, team_id, name="Owner!", kind="user")["key"] == (
        "owner_3"
    )
    # Nothing a key can be made from, and a name that starts with a digit.
    assert add_field(client, team, team_id, name="レビュー", kind="text")["key"] == (
        "field"
    )
    made = add_field(client, team, team_id, name="2nd reviewer", kind="user")
    assert made["key"] == "field_2nd_reviewer"


def test_keys_and_names_are_unique_and_keys_are_not_export_columns(client, team):
    team_id = team["team"]["id"]
    add_field(client, team, team_id, name="Reviewer", kind="user")
    assert (
        add_field(client, team, team_id, name="reviewer ", kind="user", expect=400)[
            "code"
        ]
        == "custom_field_name_taken"
    )
    assert (
        add_field(
            client,
            team,
            team_id,
            name="Second",
            key="reviewer",
            kind="user",
            expect=400,
        )["code"]
        == "custom_field_key_taken"
    )
    refused = add_field(
        client,
        team,
        team_id,
        name="Board status",
        key="status",
        kind="text",
        expect=400,
    )
    assert refused["code"] == "custom_field_key_taken"
    assert "export" in refused["detail"]
    # A key is what a script names it: lowercase, from a letter.
    add_field(client, team, team_id, name="Bad", key="Bad-Key", kind="text", expect=422)


def test_every_export_column_is_a_reserved_key():
    assert set(CSV_COLUMNS) == RESERVED_KEYS


def test_options_belong_to_select_fields_only(client, team):
    team_id = team["team"]["id"]
    for body in (
        {"name": "Severity", "kind": "select"},
        {"name": "Severity", "kind": "select", "options": [{"name": " "}]},
        {
            "name": "Severity",
            "kind": "multi_select",
            "options": [{"name": "High"}, {"name": "high"}],
        },
        {"name": "Notes", "kind": "text", "options": [{"name": "A"}]},
    ):
        refused = add_field(client, team, team_id, expect=400, **body)
        assert refused["code"] == "custom_field_options_invalid", body


def test_members_read_fields_and_only_admins_change_them(client, eng, people):
    priya = people["priya"]
    assert len(fields_of(client, priya, eng["team_id"])) == 6
    field_id = eng["fields"]["reviewer"]["id"]
    for method, path, body in (
        (
            "POST",
            f"/teams/{eng['team_id']}/custom-fields",
            {"name": "X", "kind": "text"},
        ),
        ("PATCH", f"/custom-fields/{field_id}", {"name": "Mine"}),
        ("DELETE", f"/custom-fields/{field_id}", None),
        (
            "PUT",
            f"/teams/{eng['team_id']}/custom-fields/order",
            {"field_ids": [field_id]},
        ),
    ):
        response = client.request(method, path, json=body, headers=priya["headers"])
        assert response.status_code == 403, (method, path)
        assert response.json()["code"] == "not_team_admin"


def test_another_team_cannot_see_them(client, eng, auth):
    stranger = auth(email="stranger@softtrack.dev", full_name="Stranger")
    response = client.get(
        f"/teams/{eng['team_id']}/custom-fields", headers=stranger["headers"]
    )
    assert response.status_code == 403
    missing = client.patch(
        "/custom-fields/9999", json={"name": "X"}, headers=eng["headers"]
    )
    assert missing.status_code == 404
    assert missing.json()["code"] == "custom_field_not_found"


def test_reordering_takes_the_active_fields_and_archived_ones_keep_their_place(
    client, eng
):
    fields = eng["fields"]
    change_field(client, eng, fields["environment"]["id"], archived=True)
    active = [
        fields[name]["id"]
        for name in ("release", "customer", "sentry", "reviewer", "qa")
    ]
    order = f"/teams/{eng['team_id']}/custom-fields/order"

    stale = client.put(order, json={"field_ids": active[:-1]}, headers=eng["headers"])
    assert stale.status_code == 400
    assert stale.json()["code"] == "custom_field_order_incomplete"

    response = client.put(order, json={"field_ids": active}, headers=eng["headers"])
    assert response.status_code == 200, response.text
    assert [f["key"] for f in response.json()] == [
        "target_release",
        "customer",
        "environment",
        "sentry_url",
        "reviewer",
        "qa_assignee",
    ]


def test_archiving_and_restoring(client, eng):
    field_id = eng["fields"]["customer"]["id"]
    archived = change_field(client, eng, field_id, archived=True)
    assert archived["archived_at"] is not None
    assert change_field(client, eng, field_id, archived=True)["archived_at"] == (
        archived["archived_at"]
    )
    assert change_field(client, eng, field_id, archived=False)["archived_at"] is None


# --- values on tickets ------------------------------------------------------------


def test_values_are_written_on_create_and_read_back(client, eng, people):
    priya = people["priya"]["user"]
    ticket = file_ticket(
        client,
        eng,
        eng["team_id"],
        type="bug",
        custom_fields={
            "qa_assignee": priya["id"],
            "environment": "Production",
            "sentry_url": " https://sentry.io/acme/issues/48213 ",
            "customer": "Acme Logistics",
            "target_release": "2026-10-03",
        },
    )
    values = ticket["custom_fields"]
    assert values["qa_assignee"]["id"] == priya["id"]
    assert values["qa_assignee"]["full_name"] == "Priya Raman"
    assert values["environment"] == "production"
    assert values["sentry_url"] == "https://sentry.io/acme/issues/48213"
    assert values["customer"] == "Acme Logistics"
    assert values["target_release"] == "2026-10-03"
    assert "reviewer" not in values

    listed = client.get(
        f"/teams/{eng['team_id']}/tickets", headers=eng["headers"]
    ).json()
    [row] = listed["items"]
    assert row["custom_fields"] == values


def test_a_ticket_with_no_values_has_an_empty_map(client, team):
    ticket = file_ticket(client, team, team["team"]["id"])
    assert ticket["custom_fields"] == {}


def test_a_required_field_is_named_when_it_is_missing(client, eng):
    refused = file_ticket(client, eng, eng["team_id"], type="bug", expect=400)
    assert refused["code"] == "custom_field_required"
    assert refused["detail"] == "QA assignee is required on Engineering tickets."
    # And nothing was filed: the number was not used up.
    listed = client.get(f"/teams/{eng['team_id']}/tickets", headers=eng["headers"])
    assert listed.json()["total"] == 0


def test_every_missing_required_field_is_named(client, eng):
    change_field(client, eng, eng["fields"]["environment"]["id"], required=True)
    change_field(client, eng, eng["fields"]["customer"]["id"], required=True)
    refused = file_ticket(client, eng, eng["team_id"], type="bug", expect=400)
    assert refused["detail"] == (
        "QA assignee, Environment and Customer are required on Engineering tickets."
    )


def test_required_counts_only_where_the_field_applies_and_is_not_archived(
    client, eng, people
):
    change_field(client, eng, eng["fields"]["environment"]["id"], required=True)
    priya = people["priya"]["user"]["id"]
    # Environment is a bug field; a task does not have it.
    file_ticket(
        client, eng, eng["team_id"], type="task", custom_fields={"qa_assignee": priya}
    )
    file_ticket(
        client,
        eng,
        eng["team_id"],
        type="bug",
        custom_fields={"qa_assignee": priya},
        expect=400,
    )
    change_field(client, eng, eng["fields"]["qa"]["id"], archived=True)
    change_field(client, eng, eng["fields"]["environment"]["id"], archived=True)
    file_ticket(client, eng, eng["team_id"], type="bug")


def test_a_patch_changes_only_the_keys_it_names_and_null_clears(client, eng, people):
    priya = people["priya"]["user"]["id"]
    daniel = people["daniel"]["user"]["id"]
    ticket = file_ticket(
        client,
        eng,
        eng["team_id"],
        type="bug",
        custom_fields={"qa_assignee": priya, "customer": "Acme"},
    )
    updated = patch(
        client,
        eng,
        ticket["id"],
        custom_fields={"reviewer": daniel, "customer": None},
    )
    assert updated["custom_fields"]["qa_assignee"]["id"] == priya
    assert updated["custom_fields"]["reviewer"]["id"] == daniel
    assert "customer" not in updated["custom_fields"]
    # Editing something else leaves them alone.
    again = patch(client, eng, ticket["id"], priority="high")
    assert again["custom_fields"] == updated["custom_fields"]


def test_a_required_field_cannot_be_cleared(client, eng, people):
    ticket = file_ticket(
        client,
        eng,
        eng["team_id"],
        custom_fields={"qa_assignee": people["priya"]["user"]["id"]},
    )
    refused = patch(
        client, eng, ticket["id"], custom_fields={"qa_assignee": None}, expect=400
    )
    assert refused["code"] == "custom_field_required"
    assert refused["detail"] == "QA assignee is required on Engineering tickets."


@pytest.mark.parametrize(
    ("key", "value", "code"),
    [
        ("customer", 12, "custom_field_invalid_value"),
        ("customer", "x" * 501, "custom_field_invalid_value"),
        ("sentry_url", "javascript:alert(1)", "custom_field_invalid_value"),
        ("sentry_url", "sentry.io/acme", "custom_field_invalid_value"),
        ("environment", "Nowhere", "custom_field_invalid_value"),
        ("target_release", "next Friday", "custom_field_invalid_value"),
        ("target_release", 20261003, "custom_field_invalid_value"),
        ("reviewer", "daniel", "custom_field_invalid_value"),
        ("reviewer", True, "custom_field_invalid_value"),
        ("nonsense", "x", "custom_field_not_found"),
    ],
)
def test_a_value_of_the_wrong_kind_is_refused(client, eng, people, key, value, code):
    ticket = file_ticket(
        client,
        eng,
        eng["team_id"],
        type="bug",
        custom_fields={"qa_assignee": people["priya"]["user"]["id"]},
    )
    refused = patch(client, eng, ticket["id"], custom_fields={key: value}, expect=400)
    assert refused["code"] == code, refused


def test_the_other_kinds(client, team):
    team_id = team["team"]["id"]
    add_field(client, team, team_id, name="Points", kind="number")
    add_field(client, team, team_id, name="Signed off", kind="checkbox")
    add_field(
        client,
        team,
        team_id,
        name="Platforms",
        kind="multi_select",
        options=[{"name": "iOS"}, {"name": "Android"}, {"name": "Web"}],
    )
    ticket = file_ticket(
        client,
        team,
        team_id,
        custom_fields={
            "points": 2.5,
            "signed_off": True,
            "platforms": ["Web", "ios", "web"],
        },
    )
    assert ticket["custom_fields"] == {
        "points": 2.5,
        # In the options' order, once each, by id.
        "platforms": ["ios", "web"],
        "signed_off": True,
    }
    for key, value in (("points", "3"), ("points", False), ("signed_off", "yes")):
        refused = patch(
            client, team, ticket["id"], custom_fields={key: value}, expect=400
        )
        assert refused["code"] == "custom_field_invalid_value"

    # Unticking and emptying clear the value.
    cleared = patch(
        client,
        team,
        ticket["id"],
        custom_fields={"signed_off": False, "platforms": [], "points": -4},
    )
    assert cleared["custom_fields"] == {"points": -4}


def test_a_person_has_to_be_on_the_team(client, eng, people):
    refused = file_ticket(
        client,
        eng,
        eng["team_id"],
        custom_fields={"qa_assignee": people["olga"]["user"]["id"]},
        expect=400,
    )
    assert refused["code"] == "user_not_on_team"
    assert "QA assignee" in refused["detail"]


def test_a_field_bound_to_other_types_is_refused_and_kept_when_the_type_changes(
    client, eng, people
):
    priya = people["priya"]["user"]["id"]
    task = file_ticket(
        client, eng, eng["team_id"], type="task", custom_fields={"qa_assignee": priya}
    )
    refused = patch(
        client, eng, task["id"], custom_fields={"environment": "dev"}, expect=400
    )
    assert refused["code"] == "custom_field_not_applicable"
    assert refused["detail"] == "Environment is not a field on tasks"

    # The type is changed first, so one PATCH can do both.
    bug = patch(
        client, eng, task["id"], type="bug", custom_fields={"environment": "dev"}
    )
    assert bug["custom_fields"]["environment"] == "dev"
    # Back to a task: hidden by the form, still held and still readable.
    back = patch(client, eng, task["id"], type="task")
    assert back["custom_fields"]["environment"] == "dev"

    story = file_ticket(
        client, eng, eng["team_id"], type="story", custom_fields={"qa_assignee": priya}
    )
    refused = patch(
        client,
        eng,
        story["id"],
        custom_fields={"sentry_url": "https://x.io"},
        expect=400,
    )
    assert refused["detail"] == "Sentry URL is not a field on stories"


def test_an_archived_fields_values_are_read_only(client, eng, people):
    ticket = file_ticket(
        client,
        eng,
        eng["team_id"],
        type="bug",
        custom_fields={
            "qa_assignee": people["priya"]["user"]["id"],
            "customer": "Acme",
        },
    )
    change_field(client, eng, eng["fields"]["customer"]["id"], archived=True)
    read = client.get(f"/tickets/{ticket['id']}", headers=eng["headers"]).json()
    assert read["custom_fields"]["customer"] == "Acme"
    refused = patch(
        client, eng, ticket["id"], custom_fields={"customer": "Other"}, expect=400
    )
    assert refused["code"] == "custom_field_archived"
    # Sending what it already holds changes nothing, so it is not refused.
    patch(client, eng, ticket["id"], custom_fields={"customer": "Acme"})


def test_options_are_renamed_by_id_and_removed_from_tickets(client, eng, people):
    priya = people["priya"]["user"]["id"]
    ticket = file_ticket(
        client,
        eng,
        eng["team_id"],
        type="bug",
        custom_fields={"qa_assignee": priya, "environment": "staging"},
    )
    environment = eng["fields"]["environment"]
    renamed = change_field(
        client,
        eng,
        environment["id"],
        options=[
            {"id": "production", "name": "Prod"},
            {"id": "staging", "name": "Pre-prod"},
            {"name": "Staging"},
        ],
    )
    assert renamed["options"] == [
        {"id": "production", "name": "Prod"},
        {"id": "staging", "name": "Pre-prod"},
        # A new option named like a kept one's id gets an id of its own.
        {"id": "staging_2", "name": "Staging"},
    ]
    read = client.get(f"/tickets/{ticket['id']}", headers=eng["headers"]).json()
    assert read["custom_fields"]["environment"] == "staging"

    unknown = change_field(
        client, eng, environment["id"], options=[{"id": "qa", "name": "QA"}], expect=400
    )
    assert unknown["code"] == "custom_field_options_invalid"

    change_field(
        client, eng, environment["id"], options=[{"id": "production", "name": "Prod"}]
    )
    read = client.get(f"/tickets/{ticket['id']}", headers=eng["headers"]).json()
    assert "environment" not in read["custom_fields"]


def test_removing_an_option_takes_it_out_of_multi_select_values(client, team):
    team_id = team["team"]["id"]
    field = add_field(
        client,
        team,
        team_id,
        name="Platforms",
        kind="multi_select",
        options=[{"name": "iOS"}, {"name": "Web"}],
    )
    both = file_ticket(
        client, team, team_id, custom_fields={"platforms": ["ios", "web"]}
    )
    ios = file_ticket(client, team, team_id, custom_fields={"platforms": ["ios"]})
    change_field(client, team, field["id"], options=[{"id": "web", "name": "Web"}])
    get = lambda t: client.get(f"/tickets/{t['id']}", headers=team["headers"]).json()
    assert get(both)["custom_fields"] == {"platforms": ["web"]}
    assert get(ios)["custom_fields"] == {}


# --- history, notifications, webhooks ------------------------------------------------


def test_changes_are_in_the_history_and_where_it_started_is_not(client, eng, people):
    priya = people["priya"]["user"]["id"]
    daniel = people["daniel"]["user"]["id"]
    ticket = file_ticket(
        client,
        eng,
        eng["team_id"],
        type="bug",
        custom_fields={"qa_assignee": priya, "environment": "production"},
    )
    patch(
        client,
        eng,
        ticket["id"],
        custom_fields={
            "qa_assignee": daniel,
            "environment": "dev",
            "customer": "Acme",
        },
    )
    events = client.get(
        f"/tickets/{ticket['id']}/events", headers=eng["headers"]
    ).json()
    by_key = {e["custom_field"]["key"]: e for e in events}
    assert set(by_key) == {"qa_assignee", "environment", "customer"}
    assert {e["field"] for e in events} == {"custom_field"}

    qa = by_key["qa_assignee"]
    assert qa["custom_field"]["name"] == "QA assignee"
    assert qa["custom_field"]["kind"] == "user"
    assert (qa["old_value"], qa["new_value"]) == (str(priya), str(daniel))
    assert (qa["old_label"], qa["new_label"]) == ("Priya Raman", "Daniel Okafor")
    env = by_key["environment"]
    assert (env["old_label"], env["new_label"]) == ("Production", "Dev")
    customer = by_key["customer"]
    assert (customer["old_value"], customer["new_value"]) == (None, "Acme")
    assert customer["new_label"] is None
    assert qa["actor"]["id"] == eng["user"]["id"]


def test_multi_select_and_checkbox_history(client, team):
    team_id = team["team"]["id"]
    add_field(client, team, team_id, name="Signed off", kind="checkbox")
    add_field(
        client,
        team,
        team_id,
        name="Platforms",
        kind="multi_select",
        options=[{"name": "iOS"}, {"name": "Web"}],
    )
    ticket = file_ticket(client, team, team_id)
    patch(
        client,
        team,
        ticket["id"],
        custom_fields={"signed_off": True, "platforms": ["web", "ios"]},
    )
    patch(client, team, ticket["id"], custom_fields={"signed_off": False})
    events = client.get(
        f"/tickets/{ticket['id']}/events", headers=team["headers"]
    ).json()
    platforms = next(e for e in events if e["custom_field"]["key"] == "platforms")
    assert json.loads(platforms["new_value"]) == ["ios", "web"]
    assert platforms["new_label"] == "iOS, Web"
    ticks = [
        (e["old_value"], e["new_value"])
        for e in events
        if e["custom_field"]["key"] == "signed_off"
    ]
    assert ticks == [(None, "true"), ("true", None)]


def test_being_named_in_a_user_field_notifies_and_watches(client, eng, people, session):
    priya = people["priya"]
    daniel = people["daniel"]
    ticket = file_ticket(
        client,
        eng,
        eng["team_id"],
        custom_fields={"qa_assignee": priya["user"]["id"]},
    )
    patch(client, eng, ticket["id"], custom_fields={"reviewer": daniel["user"]["id"]})

    for person, field in ((priya, "QA assignee"), (daniel, "Reviewer")):
        inbox = client.get("/notifications", headers=person["headers"]).json()
        [item] = inbox["items"]
        assert item["kind"] == "field_assigned"
        assert item["field_name"] == field
        assert item["actor"]["id"] == eng["user"]["id"]
        watch = client.get(
            f"/tickets/{ticket['id']}/watch", headers=person["headers"]
        ).json()
        assert watch == {"watching": True}


def test_one_notification_per_person_per_change(client, eng, people):
    priya = people["priya"]
    ticket = file_ticket(
        client,
        eng,
        eng["team_id"],
        assignee_id=priya["user"]["id"],
        custom_fields={
            "qa_assignee": priya["user"]["id"],
            "reviewer": priya["user"]["id"],
        },
    )
    inbox = client.get("/notifications", headers=priya["headers"]).json()
    assert [n["kind"] for n in inbox["items"]] == ["assigned"]

    # A status change in the same PATCH as being named tells Priya once too.
    patch(
        client,
        eng,
        ticket["id"],
        status_id=eng["status_ids"]["Done"],
        custom_fields={"reviewer": people["daniel"]["user"]["id"]},
    )
    daniel_inbox = client.get(
        "/notifications", headers=people["daniel"]["headers"]
    ).json()
    assert [n["kind"] for n in daniel_inbox["items"]] == ["field_assigned"]


def test_naming_yourself_tells_nobody(client, eng):
    file_ticket(
        client, eng, eng["team_id"], custom_fields={"qa_assignee": eng["user"]["id"]}
    )
    inbox = client.get("/notifications", headers=eng["headers"]).json()
    assert inbox["items"] == []


def test_the_digest_says_which_field(client, eng, people):
    from lib_softtrack.digest import _sentence
    from lib_softtrack.models.notifications import NotificationRead

    file_ticket(
        client,
        eng,
        eng["team_id"],
        custom_fields={"qa_assignee": people["priya"]["user"]["id"]},
    )
    [item] = client.get("/notifications", headers=people["priya"]["headers"]).json()[
        "items"
    ]
    assert _sentence(NotificationRead.model_validate(item)) == (
        "Demo User set you as QA assignee on ENG-1"
    )


def test_a_webhook_says_which_field_changed(client, eng, people, session):
    hook = client.post(
        f"/teams/{eng['team_id']}/outbound-webhooks",
        json={"url": "https://93.184.216.34/softtrack", "events": ["ticket.updated"]},
        headers=eng["headers"],
    )
    assert hook.status_code == 200, hook.text
    ticket = file_ticket(
        client,
        eng,
        eng["team_id"],
        custom_fields={"qa_assignee": people["priya"]["user"]["id"]},
    )
    patch(
        client,
        eng,
        ticket["id"],
        custom_fields={"reviewer": people["daniel"]["user"]["id"]},
    )

    sent = []
    session.expire_all()
    outbound.deliver_due(
        session, sender=lambda url, headers, body: sent.append(body) or (200, "ok")
    )
    [body] = [json.loads(raw) for raw in sent]
    changes = body["data"]["changes"]
    assert changes == {
        "custom_fields.reviewer": {"from": None, "to": people["daniel"]["user"]["id"]}
    }
    ticket_values = body["data"]["ticket"]["custom_fields"]
    assert ticket_values["reviewer"]["username"] == people["daniel"]["user"]["username"]


# --- the export, moves and deletes -----------------------------------------------------


def test_the_export_appends_a_column_per_field(client, eng, people):
    add_field(client, eng, eng["team_id"], name="Points", kind="number")
    add_field(client, eng, eng["team_id"], name="Signed off", kind="checkbox")
    priya = people["priya"]["user"]
    file_ticket(
        client,
        eng,
        eng["team_id"],
        type="bug",
        custom_fields={
            "qa_assignee": priya["id"],
            "environment": "staging",
            "customer": "=HYPERLINK(1)",
            "points": -3,
            "signed_off": True,
        },
    )
    response = client.get(
        f"/teams/{eng['team_id']}/tickets/export", headers=eng["headers"]
    )
    assert response.status_code == 200, response.text
    rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    header, row = rows[0], rows[1]
    assert header[: len(CSV_COLUMNS)] == CSV_COLUMNS
    assert header[len(CSV_COLUMNS) :] == [
        "qa_assignee",
        "reviewer",
        "environment",
        "sentry_url",
        "customer",
        "target_release",
        "points",
        "signed_off",
    ]
    cells = dict(zip(header, row))
    assert cells["qa_assignee"] == priya["username"]
    assert cells["reviewer"] == ""
    assert cells["environment"] == "Staging"
    # Typed text is made safe to open; a number is left a number.
    assert cells["customer"] == "'=HYPERLINK(1)"
    assert cells["points"] == "-3"
    assert cells["signed_off"] == "true"


def test_a_move_to_another_team_clears_the_values(client, eng, people, session):
    ops = client.post(
        "/teams", json={"name": "Operations", "key": "OPS"}, headers=eng["headers"]
    ).json()
    ticket = file_ticket(
        client,
        eng,
        eng["team_id"],
        type="bug",
        custom_fields={
            "qa_assignee": people["priya"]["user"]["id"],
            "customer": "Acme",
        },
    )
    plan = client.get(
        f"/tickets/{ticket['id']}/transfer",
        params={"team_id": ops["id"]},
        headers=eng["headers"],
    ).json()
    assert plan["fields_cleared"] == ["QA assignee", "Customer"]

    moved = client.post(
        f"/tickets/{ticket['id']}/transfer",
        json={"team_id": ops["id"]},
        headers=eng["headers"],
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["ticket"]["custom_fields"] == {}
    session.expire_all()
    assert session.exec(select(CustomFieldValue)).all() == []


def test_deleting_a_ticket_takes_its_values(client, eng, people, session):
    ticket = file_ticket(
        client,
        eng,
        eng["team_id"],
        custom_fields={"qa_assignee": people["priya"]["user"]["id"]},
    )
    response = delete_for_good(client, eng["headers"], ticket["id"])
    assert response.status_code == 204, response.text
    assert session.exec(select(CustomFieldValue)).all() == []


def test_a_field_is_archived_before_it_is_deleted_and_takes_its_history(
    client, eng, people, session
):
    ticket = file_ticket(
        client,
        eng,
        eng["team_id"],
        custom_fields={"qa_assignee": people["priya"]["user"]["id"]},
    )
    patch(
        client,
        eng,
        ticket["id"],
        custom_fields={"reviewer": people["daniel"]["user"]["id"]},
    )
    reviewer = eng["fields"]["reviewer"]["id"]

    refused = client.delete(f"/custom-fields/{reviewer}", headers=eng["headers"])
    assert refused.status_code == 409
    assert refused.json()["code"] == "custom_field_not_archived"

    change_field(client, eng, reviewer, archived=True)
    response = client.delete(f"/custom-fields/{reviewer}", headers=eng["headers"])
    assert response.status_code == 204, response.text

    session.expire_all()
    assert [row.field_id for row in session.exec(select(CustomFieldValue))] == [
        eng["fields"]["qa"]["id"]
    ]
    assert (
        session.exec(
            select(TicketEvent).where(TicketEvent.custom_field_id == reviewer)
        ).all()
        == []
    )
    assert (
        session.exec(
            select(Notification).where(Notification.custom_field_id == reviewer)
        ).all()
        == []
    )
    read = client.get(f"/tickets/{ticket['id']}", headers=eng["headers"]).json()
    assert set(read["custom_fields"]) == {"qa_assignee"}
    # Priya still watches; the watch was about the ticket, not the field.
    assert session.exec(select(TicketWatch)).all()
