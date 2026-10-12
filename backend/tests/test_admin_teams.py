"""Every team on the instance, for a site admin (#307): Administration -> Teams."""

import logging
from datetime import timedelta

import pytest
from sqlmodel import func, select

from lib_softtrack.tables import (
    Label,
    Project,
    SavedView,
    Sprint,
    Team,
    TeamMember,
    TeamRequest,
    TeamRequestState,
    Ticket,
    TicketSchedule,
    utcnow,
)


class _Lines(logging.Handler):
    def __init__(self):
        super().__init__(logging.INFO)
        self.lines: list[str] = []

    def emit(self, record):
        if record.getMessage().startswith("team."):
            self.lines.append(record.getMessage())


@pytest.fixture
def team_log():
    """What the page records, as the server writes it (see test_finance_access
    for why the logger rather than caplog)."""
    logger = logging.getLogger("uvicorn.error")
    handler, level = _Lines(), logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    yield handler.lines
    logger.removeHandler(handler)
    logger.setLevel(level)


@pytest.fixture
def instance(client, auth):
    """A site admin on no team, and three teams run by other people."""
    admin = auth(email="it@softtrack.dev", full_name="Ira Admin")
    amina = auth(email="amina@softtrack.dev", full_name="Amina Khan")
    lena = auth(email="lena@softtrack.dev", full_name="Lena Fischer")
    tomas = auth(email="tomas@softtrack.dev", full_name="Tomas Silva")

    def make(actor, name, key):
        response = client.post(
            "/teams", json={"name": name, "key": key}, headers=actor["headers"]
        )
        assert response.status_code == 200, response.text
        return response.json()

    eng = make(amina, "Engineering", "ENG")
    prd = make(lena, "Product & Design", "PRD")
    hck = make(lena, "Hackday 2025", "HCK")
    # Amina is a second admin of Engineering; Tomas a member of Product.
    for team, person, role in ((eng, lena, "admin"), (prd, tomas, "member")):
        response = client.post(
            f"/teams/{team['id']}/members",
            json={"email": person["user"]["email"], "role": role},
            headers=(amina if team is eng else lena)["headers"],
        )
        assert response.status_code == 200, response.text
    return {
        "admin": admin,
        "amina": amina,
        "lena": lena,
        "tomas": tomas,
        "eng": eng,
        "prd": prd,
        "hck": hck,
    }


def teams(client, actor, **params):
    response = client.get("/admin/teams", params=params, headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def ticket(client, actor, team_id, title="Work"):
    response = client.post(
        f"/teams/{team_id}/tickets", json={"title": title}, headers=actor["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def by_key(page):
    return {row["key"]: row for row in page["items"]}


# --- the list -------------------------------------------------------------------


def test_only_a_site_admin_sees_every_team(client, instance):
    response = client.get("/admin/teams", headers=instance["amina"]["headers"])
    assert response.status_code == 403
    assert response.json()["code"] == "not_site_admin"


def test_every_team_with_its_size_dates_and_admins(client, instance):
    """The site admin is on none of them and sees all three, by name."""
    ticket(client, instance["amina"], instance["eng"]["id"])
    ticket(client, instance["amina"], instance["eng"]["id"])

    page = teams(client, instance["admin"])
    assert page["total"] == 3
    assert [row["key"] for row in page["items"]] == ["ENG", "HCK", "PRD"]
    rows = by_key(page)
    eng, prd = rows["ENG"], rows["PRD"]
    assert eng["name"] == "Engineering"
    assert eng["member_count"] == 2
    assert [a["full_name"] for a in eng["admins"]] == ["Amina Khan", "Lena Fischer"]
    assert eng["ticket_count"] == 2
    assert eng["created_at"]
    assert eng["last_activity_at"] >= eng["created_at"]
    assert eng["quiet"] is False
    assert prd["member_count"] == 2
    assert [a["full_name"] for a in prd["admins"]] == ["Lena Fischer"]
    assert prd["ticket_count"] == 0


def test_no_tickets_on_the_page(client, instance):
    """A count, and nothing of what they say."""
    ticket(client, instance["amina"], instance["eng"]["id"], title="Secret plan")
    response = client.get("/admin/teams", headers=instance["admin"]["headers"])
    assert "Secret plan" not in response.text
    # And being able to see the team still does not open its board.
    board = client.get(
        f"/teams/{instance['eng']['id']}/tickets", headers=instance["admin"]["headers"]
    )
    assert board.status_code == 403


def test_a_trashed_ticket_is_not_counted_but_keeps_the_team_from_being_deleted(
    client, instance
):
    work = ticket(client, instance["lena"], instance["hck"]["id"])
    assert (
        client.delete(
            f"/tickets/{work['id']}", headers=instance["lena"]["headers"]
        ).status_code
        == 204
    )
    hck = by_key(teams(client, instance["admin"]))["HCK"]
    assert hck["ticket_count"] == 0
    assert hck["can_delete"] is False


def test_searching_by_name_and_key(client, instance):
    by_name = teams(client, instance["admin"], q="hack")
    assert [row["key"] for row in by_name["items"]] == ["HCK"]
    by_key_ = teams(client, instance["admin"], q="prd")
    assert [row["key"] for row in by_key_["items"]] == ["PRD"]
    assert teams(client, instance["admin"], q="zzz")["total"] == 0


def test_filtering_to_teams_with_one_admin(client, instance):
    page = teams(client, instance["admin"], filter="one_admin")
    assert sorted(row["key"] for row in page["items"]) == ["HCK", "PRD"]


def test_a_deactivated_admin_does_not_count(client, instance):
    """Engineering's second admin leaving the company leaves it with one."""
    client.patch(
        f"/admin/users/{instance['lena']['user']['id']}",
        json={"is_active": False},
        headers=instance["admin"]["headers"],
    )
    eng = by_key(teams(client, instance["admin"], filter="one_admin"))["ENG"]
    assert [a["full_name"] for a in eng["admins"]] == ["Amina Khan"]
    assert eng["member_count"] == 1


def test_filtering_to_teams_with_nothing_in_thirty_days(client, instance, session):
    """Quiet is when anything last happened, not when the team was made."""
    old = utcnow() - timedelta(days=142)
    for key in ("HCK", "ENG"):
        row = session.exec(select(Team).where(Team.key == key)).one()
        row.created_at = old
        session.add(row)
    session.commit()
    # Engineering was made long ago and worked in today.
    ticket(client, instance["amina"], instance["eng"]["id"])

    page = teams(client, instance["admin"], filter="quiet")
    assert [row["key"] for row in page["items"]] == ["HCK"]
    assert page["items"][0]["quiet"] is True


def test_filtering_to_archived_teams_and_they_are_not_quiet(client, instance, session):
    hck = session.get(Team, instance["hck"]["id"])
    hck.created_at = utcnow() - timedelta(days=300)
    session.add(hck)
    session.commit()
    archive(client, instance, instance["hck"]["id"])

    archived = teams(client, instance["admin"], filter="archived")
    assert [row["key"] for row in archived["items"]] == ["HCK"]
    assert archived["items"][0]["archived_at"]
    assert teams(client, instance["admin"], filter="quiet")["total"] == 0
    assert "HCK" not in by_key(teams(client, instance["admin"], filter="one_admin"))
    # And All still lists it.
    assert teams(client, instance["admin"])["total"] == 3


def test_the_list_pages(client, instance):
    page = teams(client, instance["admin"], limit=2, offset=1)
    assert page["total"] == 3
    assert [row["key"] for row in page["items"]] == ["HCK", "PRD"]


def test_a_site_admin_reads_a_teams_roster(client, instance):
    response = client.get(
        f"/admin/teams/{instance['prd']['id']}/members",
        headers=instance["admin"]["headers"],
    )
    assert response.status_code == 200, response.text
    assert {(m["user"]["full_name"], m["role"]) for m in response.json()} == {
        ("Lena Fischer", "admin"),
        ("Tomas Silva", "member"),
    }
    refused = client.get(
        f"/admin/teams/{instance['prd']['id']}/members",
        headers=instance["tomas"]["headers"],
    )
    assert refused.status_code == 403


# --- appointing an admin -------------------------------------------------------------


def appoint(client, instance, team_id, user_id, expect=200):
    response = client.post(
        f"/admin/teams/{team_id}/admins",
        json={"user_id": user_id},
        headers=instance["admin"]["headers"],
    )
    assert response.status_code == expect, response.text
    return response.json()


def test_appointing_a_member_makes_them_an_admin_and_is_recorded(
    client, instance, session, team_log
):
    prd = appoint(
        client, instance, instance["prd"]["id"], instance["tomas"]["user"]["id"]
    )
    assert [a["full_name"] for a in prd["admins"]] == ["Lena Fischer", "Tomas Silva"]
    membership = session.get(
        TeamMember, (instance["prd"]["id"], instance["tomas"]["user"]["id"])
    )
    assert membership.role == "admin"
    assert len(team_log) == 1
    assert team_log[0].startswith("team.admin_appointed at=")
    assert "by=it team=PRD user=tomas was=member" in team_log[0]


def test_appointing_somebody_not_on_the_team_adds_them_as_its_admin(client, instance):
    hck = appoint(
        client, instance, instance["hck"]["id"], instance["amina"]["user"]["id"]
    )
    assert hck["member_count"] == 2
    assert {a["full_name"] for a in hck["admins"]} == {"Amina Khan", "Lena Fischer"}
    # Now Amina can run it.
    response = client.get(
        f"/teams/{instance['hck']['id']}/members",
        headers=instance["amina"]["headers"],
    )
    assert response.status_code == 200


def test_appointing_an_admin_twice_says_so(client, instance, team_log):
    response = client.post(
        f"/admin/teams/{instance['prd']['id']}/admins",
        json={"user_id": instance["lena"]["user"]["id"]},
        headers=instance["admin"]["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "already_team_admin"
    assert team_log == []


def test_appointing_needs_an_active_account_from_inside(client, instance, auth):
    tomas = instance["tomas"]["user"]["id"]
    client.patch(
        f"/admin/users/{tomas}",
        json={"is_active": False},
        headers=instance["admin"]["headers"],
    )
    response = client.post(
        f"/admin/teams/{instance['hck']['id']}/admins",
        json={"user_id": tomas},
        headers=instance["admin"]["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "account_deactivated"

    client_ = auth(email="client@example.com", full_name="A Client")
    client.patch(
        f"/admin/users/{client_['user']['id']}",
        json={"is_external": True},
        headers=instance["admin"]["headers"],
    )
    response = client.post(
        f"/admin/teams/{instance['hck']['id']}/admins",
        json={"user_id": client_["user"]["id"]},
        headers=instance["admin"]["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "external_account_is_guest"


def test_only_a_site_admin_appoints(client, instance):
    response = client.post(
        f"/admin/teams/{instance['prd']['id']}/admins",
        json={"user_id": instance["tomas"]["user"]["id"]},
        headers=instance["tomas"]["headers"],
    )
    assert response.status_code == 403


# --- archiving ------------------------------------------------------------------


def archive(client, instance, team_id, undo=False):
    response = client.post(
        f"/admin/teams/{team_id}/{'unarchive' if undo else 'archive'}",
        headers=instance["admin"]["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_archiving_and_unarchiving_are_recorded(client, instance, team_log):
    archived = archive(client, instance, instance["hck"]["id"])
    assert archived["archived_at"]
    # Archiving again changes nothing, the date included.
    again = archive(client, instance, instance["hck"]["id"])
    assert again["archived_at"] == archived["archived_at"]
    back = archive(client, instance, instance["hck"]["id"], undo=True)
    assert back["archived_at"] is None
    assert [line.split(" ")[0] for line in team_log] == [
        "team.archived",
        "team.unarchived",
    ]
    assert "by=it team=HCK" in team_log[0]


def test_an_archived_teams_key_stays_taken(client, instance):
    archive(client, instance, instance["hck"]["id"])
    response = client.post(
        "/teams",
        json={"name": "Another hackday", "key": "HCK"},
        headers=instance["amina"]["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "team_key_taken"


def test_only_a_site_admin_archives(client, instance):
    response = client.post(
        f"/admin/teams/{instance['hck']['id']}/archive",
        headers=instance["lena"]["headers"],
    )
    assert response.status_code == 403


# --- deleting -------------------------------------------------------------------


def test_a_team_with_tickets_is_archived_and_not_deleted(client, instance, session):
    ticket(client, instance["lena"], instance["hck"]["id"])
    response = client.delete(
        f"/admin/teams/{instance['hck']['id']}", headers=instance["admin"]["headers"]
    )
    assert response.status_code == 409
    assert response.json()["code"] == "team_not_empty"
    assert session.get(Team, instance["hck"]["id"]) is not None
    assert by_key(teams(client, instance["admin"]))["HCK"]["can_delete"] is False


def test_an_empty_team_is_deleted_with_everything_it_had(
    client, instance, session, team_log
):
    """Its statuses, labels, epics, sprints, views -- the team's default among
    them -- fields, rules, webhooks, repositories, share links, invitations and
    members go with it; a request that created it stays, naming no team."""
    lena = instance["lena"]
    team_id = instance["hck"]["id"]

    def post(path, body):
        response = client.post(path, json=body, headers=lena["headers"])
        assert response.status_code == 200, response.text
        return response.json()

    post(f"/teams/{team_id}/labels", {"name": "ci", "color": "#123456"})
    epic = post(f"/teams/{team_id}/projects", {"name": "Demo day"})
    post(
        f"/teams/{team_id}/sprints",
        {"starts_at": "2026-09-01", "ends_at": "2026-09-14"},
    )
    view = post(
        f"/teams/{team_id}/views",
        {"name": "Demo", "filters": {"project_id": epic["id"]}, "is_shared": True},
    )
    assert (
        client.put(
            f"/teams/{team_id}/default-view",
            json={"view_id": view["id"]},
            headers=lena["headers"],
        ).status_code
        == 200
    )
    post(f"/teams/{team_id}/custom-fields", {"name": "Reviewer", "kind": "user"})
    post(
        f"/teams/{team_id}/automation-rules",
        {
            "name": "Urgent",
            "trigger": "ticket_created",
            "actions": {"set_priority": "high"},
        },
    )
    post(
        f"/teams/{team_id}/ticket-schedules",
        {"title": "Demo prep", "frequency": "weekly", "weekdays": [0]},
    )
    post(
        f"/teams/{team_id}/outbound-webhooks",
        {"url": "https://93.184.216.34/softtrack", "events": ["ticket.created"]},
    )
    post(
        f"/teams/{team_id}/repositories",
        {"provider": "github", "full_name": "acme/hackday"},
    )
    post(f"/teams/{team_id}/share-links", {"project_id": epic["id"]})
    post(f"/teams/{team_id}/invites", {"email": "new@softtrack.dev", "role": "member"})
    session.add(
        TeamRequest(
            requester_id=lena["user"]["id"],
            name="Hackday 2025",
            key="HCK",
            reason="For the hackday",
            state=TeamRequestState.approved,
            team_id=team_id,
        )
    )
    session.commit()
    # Tickets made and purged leave no row behind.
    work = ticket(client, lena, team_id)
    client.delete(f"/tickets/{work['id']}", headers=lena["headers"])
    purged = client.delete(f"/trash/tickets/{work['id']}", headers=lena["headers"])
    assert purged.status_code == 204, purged.text

    response = client.delete(
        f"/admin/teams/{team_id}", headers=instance["admin"]["headers"]
    )
    assert response.status_code == 204, response.text

    session.expire_all()
    assert session.get(Team, team_id) is None
    for table in (
        Label,
        Project,
        Sprint,
        SavedView,
        TeamMember,
        Ticket,
        TicketSchedule,
    ):
        rows = select(func.count()).select_from(table).where(table.team_id == team_id)
        assert session.exec(rows.execution_options(include_trashed=True)).one() == 0
    request = session.exec(select(TeamRequest)).one()
    assert request.team_id is None
    assert team_log[-1].startswith("team.deleted at=")
    assert "team=HCK" in team_log[-1]
    assert [row["key"] for row in teams(client, instance["admin"])["items"]] == [
        "ENG",
        "PRD",
    ]
    # Lena's sidebar no longer has it.
    mine = client.get("/teams", headers=lena["headers"]).json()
    assert sorted(team["key"] for team in mine) == ["ENG", "PRD"]


def test_only_a_site_admin_deletes_a_team(client, instance):
    response = client.delete(
        f"/admin/teams/{instance['hck']['id']}", headers=instance["lena"]["headers"]
    )
    assert response.status_code == 403
