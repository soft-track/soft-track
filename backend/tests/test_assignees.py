"""An assignee is somebody who may hold the team's tickets (#316).

An admin or a member: not a guest, who is there to read, and not somebody on
no team, who could not even open the ticket. One question,
`teams.can_be_assigned`, is asked on every path that puts a name on a ticket,
and each path has a test here so a new one cannot forget it. The last part is
what happens to somebody's tickets when they stop being able to hold them.
"""

import io

import pytest
from sqlmodel import select

from lib_softtrack.tables import (
    AutomationRun,
    Notification,
    Ticket,
    TicketEvent,
    TicketEventField,
)

OUTSIDERS = ["stranger", "guest"]


@pytest.fixture
def crew(client, team, auth):
    """ENG with an admin, two members and a guest, and a stranger on no team."""
    team_id = team["team"]["id"]

    def join(email, name, role):
        person = auth(email=email, full_name=name)
        response = client.post(
            f"/teams/{team_id}/members",
            json={"email": email, "role": role},
            headers=team["headers"],
        )
        assert response.status_code == 200, response.text
        return person

    return {
        **team,
        "team_id": team_id,
        "admin": {"user": team["user"], "headers": team["headers"]},
        "member": join("tomas@softtrack.dev", "Tomas Silva", "member"),
        "other": join("amina@softtrack.dev", "Amina Khan", "member"),
        "guest": join("carlos@client.dev", "Carlos Rivera", "guest"),
        "stranger": auth(email="stranger@elsewhere.dev", full_name="A Stranger"),
    }


def uid(crew, who):
    return crew[who]["user"]["id"]


def make(client, crew, **fields):
    response = client.post(
        f"/teams/{crew['team_id']}/tickets",
        json={"title": "Set up laptop and accounts", **fields},
        headers=crew["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def fetch(client, crew, ticket):
    return client.get(f"/tickets/{ticket['id']}", headers=crew["headers"]).json()


def refused(response):
    assert response.status_code == 400, response.text
    assert response.json()["code"] == "user_not_on_team"
    return response.json()["detail"]


# --- every path that sets an assignee -----------------------------------------


@pytest.mark.parametrize("who", OUTSIDERS)
def test_a_new_ticket_refuses_them(client, crew, who):
    response = client.post(
        f"/teams/{crew['team_id']}/tickets",
        json={"title": "Set up laptop", "assignee_id": uid(crew, who)},
        headers=crew["headers"],
    )
    refused(response)
    listed = client.get(
        f"/teams/{crew['team_id']}/tickets", headers=crew["headers"]
    ).json()
    assert listed["total"] == 0


def test_the_sentence_says_which_it_was(client, crew):
    def create(who):
        return client.post(
            f"/teams/{crew['team_id']}/tickets",
            json={"title": "x", "assignee_id": uid(crew, who)},
            headers=crew["headers"],
        )

    assert refused(create("stranger")) == "The assignee is not a member of this team."
    assert "Guests" in refused(create("guest"))


def test_a_member_is_assigned(client, crew):
    ticket = make(client, crew, assignee_id=uid(crew, "member"))
    assert ticket["assignee"]["id"] == uid(crew, "member")


@pytest.mark.parametrize("who", OUTSIDERS)
def test_editing_one_refuses_them(client, crew, who):
    ticket = make(client, crew, assignee_id=uid(crew, "member"))
    response = client.patch(
        f"/tickets/{ticket['id']}",
        json={"assignee_id": uid(crew, who), "title": "Changed"},
        headers=crew["headers"],
    )
    refused(response)
    after = fetch(client, crew, ticket)
    assert after["assignee"]["id"] == uid(crew, "member")
    assert after["title"] == "Set up laptop and accounts"


def test_an_edit_that_sends_the_assignee_back_unchanged_still_saves(
    client, crew, session
):
    """A ticket assigned to a guest before they were refused still edits."""
    ticket = make(client, crew)
    row = session.get(Ticket, ticket["id"])
    row.assignee_id = uid(crew, "guest")
    session.add(row)
    session.commit()

    response = client.patch(
        f"/tickets/{ticket['id']}",
        json={"title": "Renamed", "assignee_id": uid(crew, "guest")},
        headers=crew["headers"],
    )
    assert response.status_code == 200, response.text
    assert response.json()["title"] == "Renamed"


@pytest.mark.parametrize("who", OUTSIDERS)
def test_a_bulk_edit_refuses_them(client, crew, who):
    tickets = [make(client, crew), make(client, crew)]
    response = client.post(
        f"/teams/{crew['team_id']}/tickets/bulk-update",
        json={
            "ticket_ids": [ticket["id"] for ticket in tickets],
            "changes": {"assignee_id": uid(crew, who)},
        },
        headers=crew["headers"],
    )
    refused(response)
    assert all(fetch(client, crew, ticket)["assignee"] is None for ticket in tickets)


@pytest.mark.parametrize("who", OUTSIDERS)
@pytest.mark.parametrize(
    "rule",
    [
        lambda person: {"actions": {"set_assignee_id": person}},
        lambda person: {
            "conditions": {"if_assignee_id": person},
            "actions": {"set_priority": "high"},
        },
    ],
    ids=["assigning them", "waiting for them"],
)
def test_a_rule_naming_them_is_refused_when_saved(client, crew, who, rule):
    body = {"conditions": {}, **rule(uid(crew, who))}
    response = client.post(
        f"/teams/{crew['team_id']}/automation-rules",
        json={"name": "Route it", "trigger": "ticket_created", **body},
        headers=crew["headers"],
    )
    refused(response)


def test_a_rule_does_not_assign_somebody_who_has_left_since(client, crew, session):
    response = client.post(
        f"/teams/{crew['team_id']}/automation-rules",
        json={
            "name": "Tomas takes new work",
            "trigger": "ticket_created",
            "conditions": {},
            "actions": {"set_assignee_id": uid(crew, "member")},
        },
        headers=crew["headers"],
    )
    assert response.status_code == 200, response.text
    client.delete(
        f"/teams/{crew['team_id']}/members/{uid(crew, 'member')}",
        headers=crew["headers"],
    )

    ticket = make(client, crew)

    assert ticket["assignee"] is None
    run = session.exec(select(AutomationRun)).one()
    assert "Did not assign Tomas Silva" in run.summary


def test_a_move_to_a_team_where_the_assignee_is_a_guest_unassigns_it(client, crew):
    ops = client.post(
        "/teams", json={"name": "Operations", "key": "OPS"}, headers=crew["headers"]
    ).json()
    client.post(
        f"/teams/{ops['id']}/members",
        json={"email": "tomas@softtrack.dev", "role": "guest"},
        headers=crew["headers"],
    )
    ticket = make(client, crew, assignee_id=uid(crew, "member"))

    plan = client.get(
        f"/tickets/{ticket['id']}/transfer",
        params={"team_id": ops["id"]},
        headers=crew["headers"],
    ).json()
    assert plan["assignee_cleared"] == "Tomas Silva"
    moved = client.post(
        f"/tickets/{ticket['id']}/transfer",
        json={"team_id": ops["id"]},
        headers=crew["headers"],
    ).json()
    assert moved["ticket"]["assignee"] is None


def test_an_import_leaves_a_guests_tickets_unassigned(client, crew):
    csv = (
        "Issue key,Summary,Assignee,Reporter\n"
        "PROJ-1,Portal copy,carlos@client.dev,carlos@client.dev\n"
        "PROJ-2,Portal login,tomas@softtrack.dev,carlos@client.dev\n"
    )

    def upload(dry_run):
        return client.post(
            f"/teams/{crew['team_id']}/import/jira",
            files={"file": ("jira.csv", io.BytesIO(csv.encode()), "text/csv")},
            data={"dry_run": str(dry_run).lower()},
            headers=crew["headers"],
        ).json()

    assert any("guests on this team" in w for w in upload(True)["warnings"])
    upload(False)

    tickets = {
        ticket["title"]: ticket
        for ticket in client.get(
            f"/teams/{crew['team_id']}/tickets", headers=crew["headers"]
        ).json()["items"]
    }
    assert tickets["Portal copy"]["assignee"] is None
    assert tickets["Portal login"]["assignee"]["id"] == uid(crew, "member")
    # Still the reporter: filing a ticket is not holding it.
    assert tickets["Portal copy"]["creator"]["id"] == uid(crew, "guest")


# --- when somebody can no longer hold tickets ---------------------------------


@pytest.fixture
def holding(client, crew):
    """Tomas holds two open tickets and one done, and one on another team."""
    done = crew["status_ids"]["Done"]
    open_one = make(client, crew, assignee_id=uid(crew, "member"))
    open_two = make(client, crew, assignee_id=uid(crew, "member"))
    finished = make(client, crew, assignee_id=uid(crew, "member"), status_id=done)
    ops = client.post(
        "/teams", json={"name": "Operations", "key": "OPS"}, headers=crew["headers"]
    ).json()
    client.post(
        f"/teams/{ops['id']}/members",
        json={"email": "tomas@softtrack.dev"},
        headers=crew["headers"],
    )
    elsewhere = client.post(
        f"/teams/{ops['id']}/tickets",
        json={"title": "Rotate keys", "assignee_id": uid(crew, "member")},
        headers=crew["headers"],
    ).json()
    return {
        **crew,
        "open": [open_one, open_two],
        "finished": finished,
        "elsewhere": elsewhere,
    }


def assignee_of(client, crew, ticket):
    assignee = fetch(client, crew, ticket)["assignee"]
    return assignee and assignee["id"]


def remove(client, crew, who, actor=None, **params):
    return client.delete(
        f"/teams/{crew['team_id']}/members/{uid(crew, who)}",
        params=params,
        headers=(actor or crew)["headers"],
    )


def test_the_list_asks_for_open_or_resolved_tickets(client, holding):
    def listed(resolved):
        return {
            ticket["id"]
            for ticket in client.get(
                f"/teams/{holding['team_id']}/tickets",
                params={"assignee_id": uid(holding, "member"), "resolved": resolved},
                headers=holding["headers"],
            ).json()["items"]
        }

    assert listed("false") == {ticket["id"] for ticket in holding["open"]}
    assert listed("true") == {holding["finished"]["id"]}


def test_removing_a_member_unassigns_their_open_tickets(client, holding, session):
    assert remove(client, holding, "member").status_code == 204

    assert [assignee_of(client, holding, t) for t in holding["open"]] == [None, None]
    # A done ticket keeps the name: it says who did the work.
    assert assignee_of(client, holding, holding["finished"]) == uid(holding, "member")
    # Another team's tickets are that team's business.
    assert assignee_of(client, holding, holding["elsewhere"]) == uid(holding, "member")
    # And each open one says who took it off them.
    events = session.exec(
        select(TicketEvent).where(
            TicketEvent.ticket_id == holding["open"][0]["id"],
            TicketEvent.field == TicketEventField.assignee,
            TicketEvent.new_value == None,  # noqa: E711 -- SQL IS NULL
        )
    ).all()
    assert [event.actor_id for event in events] == [uid(holding, "admin")]


def test_removing_a_member_can_hand_their_tickets_to_somebody(client, holding, session):
    response = remove(client, holding, "member", reassign_to=uid(holding, "other"))
    assert response.status_code == 204, response.text

    assert [assignee_of(client, holding, t) for t in holding["open"]] == [
        uid(holding, "other"),
        uid(holding, "other"),
    ]
    assert assignee_of(client, holding, holding["finished"]) == uid(holding, "member")
    told = session.exec(
        select(Notification).where(Notification.user_id == uid(holding, "other"))
    ).all()
    assert {n.ticket_id for n in told} == {t["id"] for t in holding["open"]}


@pytest.mark.parametrize("who", ["stranger", "guest", "member"])
def test_a_handover_to_somebody_who_cannot_hold_them_changes_nothing(
    client, holding, who
):
    refused(remove(client, holding, "member", reassign_to=uid(holding, who)))

    members = client.get(
        f"/teams/{holding['team_id']}/members", headers=holding["headers"]
    ).json()
    assert uid(holding, "member") in [m["user"]["id"] for m in members]
    assert [assignee_of(client, holding, t) for t in holding["open"]] == [
        uid(holding, "member"),
        uid(holding, "member"),
    ]


def test_leaving_hands_over_the_same_way(client, holding):
    response = remove(
        client,
        holding,
        "member",
        actor=holding["member"],
        reassign_to=uid(holding, "admin"),
    )
    assert response.status_code == 204, response.text
    assert [assignee_of(client, holding, t) for t in holding["open"]] == [
        uid(holding, "admin"),
        uid(holding, "admin"),
    ]


def test_a_rule_cannot_give_a_ticket_straight_back_to_them(client, holding):
    """Somebody removed is off the team before their tickets move, so a rule
    firing on the handover sees them gone."""
    response = client.post(
        f"/teams/{holding['team_id']}/automation-rules",
        json={
            "name": "Everything goes to Tomas",
            "trigger": "ticket_assigned",
            "conditions": {},
            "actions": {"set_assignee_id": uid(holding, "member")},
        },
        headers=holding["headers"],
    )
    assert response.status_code == 200, response.text

    response = remove(client, holding, "member", reassign_to=uid(holding, "other"))
    assert response.status_code == 204, response.text
    assert [assignee_of(client, holding, t) for t in holding["open"]] == [
        uid(holding, "other"),
        uid(holding, "other"),
    ]


def make_guest(client, crew, **extra):
    return client.patch(
        f"/teams/{crew['team_id']}/members/{uid(crew, 'member')}",
        json={"role": "guest", **extra},
        headers=crew["headers"],
    )


def test_making_a_member_a_guest_unassigns_their_open_tickets(client, holding):
    assert make_guest(client, holding).json()["role"] == "guest"
    assert [assignee_of(client, holding, t) for t in holding["open"]] == [None, None]
    assert assignee_of(client, holding, holding["finished"]) == uid(holding, "member")


def test_making_a_member_a_guest_can_hand_their_tickets_over(client, holding):
    response = make_guest(client, holding, reassign_to=uid(holding, "other"))
    assert response.status_code == 200, response.text
    assert [assignee_of(client, holding, t) for t in holding["open"]] == [
        uid(holding, "other"),
        uid(holding, "other"),
    ]


def test_a_handover_to_the_new_guest_is_refused(client, holding):
    refused(make_guest(client, holding, reassign_to=uid(holding, "member")))
    members = client.get(
        f"/teams/{holding['team_id']}/members", headers=holding["headers"]
    ).json()
    role = next(m["role"] for m in members if m["user"]["id"] == uid(holding, "member"))
    assert role == "member"


def test_other_role_changes_leave_tickets_alone(client, holding):
    response = client.patch(
        f"/teams/{holding['team_id']}/members/{uid(holding, 'member')}",
        json={"role": "admin", "reassign_to": uid(holding, "other")},
        headers=holding["headers"],
    )
    assert response.status_code == 200, response.text
    assert [assignee_of(client, holding, t) for t in holding["open"]] == [
        uid(holding, "member"),
        uid(holding, "member"),
    ]
