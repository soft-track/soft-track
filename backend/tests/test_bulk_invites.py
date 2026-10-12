"""Inviting many people at once (#304).

Pasted addresses, a role, one or more teams the admin administers; a preview
before anything is sent; one invitation per address per team by the rules a
single invitation follows; and a result per address afterwards.
"""

import pytest
from sqlmodel import select

import app_softtrack.invites as invite_routes
from lib_softtrack.bulk_invites import parse
from lib_softtrack.tables import PasswordReset, TeamInvite, TeamMember, User
from web import settings


class FakeMailer:
    def __init__(self, refuse=()):
        self.sent: list[tuple[str, str, str]] = []
        self.refuse = set(refuse)

    def send(self, to: str, subject: str, body: str) -> None:
        if to in self.refuse:
            raise OSError("550 mailbox unavailable")
        self.sent.append((to, subject, body))


@pytest.fixture
def mailer(monkeypatch):
    """An instance with SMTP configured, whose mail is captured."""
    fake = FakeMailer()
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(invite_routes, "get_mailer", lambda: fake)
    return fake


def bulk(client, actor, team_id, addresses, expect=200, **fields):
    response = client.post(
        f"/teams/{team_id}/invites/bulk",
        json={"addresses": addresses, **fields},
        headers=actor["headers"],
    )
    assert response.status_code == expect, response.text
    return response.json()


def second_team(client, team):
    response = client.post(
        "/teams", json={"name": "Support", "key": "SUP"}, headers=team["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def by_email(result):
    return {entry["email"]: entry for entry in result["entries"] if entry["email"]}


def test_addresses_are_separated_by_commas_spaces_and_new_lines():
    parsed = parse(
        "Hana Suzuki <Hana@Northwind.dev>, jonas@northwind.dev\n"
        "yuki@northwind.dev mei@northwind.dev;\n"
        "carlos@acme.example, priya.acme.example\n"
        '"Tanaka, Mei" <mei.t@northwind.dev>'
    )
    assert [(line, email, name) for line, _, email, name in parsed] == [
        (1, "hana@northwind.dev", "Hana Suzuki"),
        (1, "jonas@northwind.dev", None),
        (2, "yuki@northwind.dev", None),
        (2, "mei@northwind.dev", None),
        (3, "carlos@acme.example", None),
        (3, None, None),
        (4, "mei.t@northwind.dev", "Tanaka, Mei"),
    ]
    assert parsed[5][1] == "priya.acme.example"


def test_the_preview_says_what_will_happen_and_changes_nothing(
    client, team, auth, session
):
    eng = team["team"]["id"]
    sup = second_team(client, team)
    mei = auth(email="mei@northwind.dev", full_name="Mei Tanaka")
    client.post(
        f"/teams/{eng}/members",
        json={"email": "mei@northwind.dev"},
        headers=team["headers"],
    )
    client.post(
        f"/teams/{sup}/invites",
        json={"email": "yuki@northwind.dev"},
        headers=team["headers"],
    )
    tokens_before = {i.token for i in session.exec(select(TeamInvite)).all()}

    result = bulk(
        client,
        team,
        eng,
        "Hana Suzuki <hana@northwind.dev>, yuki@northwind.dev\n"
        "mei@northwind.dev priya.acme.example",
        team_ids=[sup, eng],
        preview=True,
    )

    assert result["preview"] is True
    entries = by_email(result)
    hana = entries["hana@northwind.dev"]
    assert hana["name"] == "Hana Suzuki"
    assert [(r["team_id"], r["kind"]) for r in hana["teams"]] == [
        (sup, "invite"),
        (eng, "invite"),
    ]
    yuki = {r["team_id"]: r["kind"] for r in entries["yuki@northwind.dev"]["teams"]}
    assert yuki == {sup: "fresh_link", eng: "invite"}
    mei_teams = {r["team_id"]: r for r in entries["mei@northwind.dev"]["teams"]}
    assert entries["mei@northwind.dev"]["name"] == mei["user"]["full_name"]
    assert mei_teams[eng]["kind"] == "member"
    assert mei_teams[sup]["kind"] == "invite"
    [not_an_address] = [e for e in result["entries"] if not e["is_address"]]
    assert not_an_address == {
        **not_an_address,
        "text": "priya.acme.example",
        "line": 2,
    }
    assert all(r["status"] is None for e in result["entries"] for r in e["teams"])

    # Nothing was made or refreshed.
    session.expire_all()
    assert {i.token for i in session.exec(select(TeamInvite)).all()} == tokens_before


def test_one_invitation_per_address_per_team(client, team, auth, session):
    eng = team["team"]["id"]
    sup = second_team(client, team)
    auth(email="mei@northwind.dev", full_name="Mei Tanaka")
    client.post(
        f"/teams/{eng}/members",
        json={"email": "mei@northwind.dev"},
        headers=team["headers"],
    )
    old = client.post(
        f"/teams/{sup}/invites",
        json={"email": "yuki@northwind.dev"},
        headers=team["headers"],
    ).json()

    result = bulk(
        client,
        team,
        eng,
        "hana@northwind.dev, yuki@northwind.dev, HANA@northwind.dev\n"
        "mei@northwind.dev nope",
        team_ids=[eng, sup],
        role="admin",
    )

    assert (result["sent"], result["skipped"], result["failed"]) == (5, 2, 0)
    entries = by_email(result)
    # The same address twice is one person.
    assert len([e for e in result["entries"] if e["is_address"]]) == 3
    mei = {r["team_id"]: r for r in entries["mei@northwind.dev"]["teams"]}
    assert mei[eng]["status"] == "skipped"
    assert mei[eng]["reason"] == "already_member"
    assert mei[sup]["status"] == "sent"

    rows = session.exec(select(TeamInvite)).all()
    assert sorted((r.email, r.team_id) for r in rows) == sorted(
        [
            ("hana@northwind.dev", eng),
            ("hana@northwind.dev", sup),
            ("yuki@northwind.dev", eng),
            ("yuki@northwind.dev", sup),
            ("mei@northwind.dev", sup),
        ]
    )
    assert all(r.role == "admin" for r in rows)
    # The live invitation got a fresh link, and the old one stopped working.
    yuki_sup = next(
        r for r in entries["yuki@northwind.dev"]["teams"] if r["team_id"] == sup
    )
    assert yuki_sup["invite"]["token"] != old["token"]
    assert client.get(f"/invites/{old['token']}").status_code == 404
    # Nothing was emailed: no mail server, and none asked for.
    assert all(r.emailed_at is None for r in rows)


def test_a_link_stays_tied_to_its_address(client, team, auth):
    """Bulk links are ordinary invitations: a forwarded one admits nobody."""
    result = bulk(client, team, team["team"]["id"], "hana@northwind.dev")
    token = result["entries"][0]["teams"][0]["invite"]["token"]
    stranger = auth(email="stranger@example.com")
    response = client.post(f"/invites/{token}/accept", headers=stranger["headers"])
    assert response.status_code == 403
    assert response.json()["code"] == "invite_wrong_recipient"


def test_only_teams_you_administer(client, team, auth):
    other = auth(email="other@example.com")
    theirs = client.post(
        "/teams", json={"name": "Theirs", "key": "THR"}, headers=other["headers"]
    ).json()["id"]
    response = client.post(
        f"/teams/{team['team']['id']}/invites/bulk",
        json={"addresses": "a@example.com", "team_ids": [theirs]},
        headers=team["headers"],
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_member"

    # A member of the team, not its admin.
    client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "other@example.com"},
        headers=team["headers"],
    )
    response = client.post(
        f"/teams/{team['team']['id']}/invites/bulk",
        json={"addresses": "a@example.com", "preview": True},
        headers=other["headers"],
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_team_admin"


def test_a_limit_on_addresses_per_submission(client, team, monkeypatch):
    monkeypatch.setattr(settings, "bulk_invite_limit", 3)
    team_id = team["team"]["id"]
    response = client.post(
        f"/teams/{team_id}/invites/bulk",
        json={"addresses": "a@x.dev b@x.dev c@x.dev nope", "preview": True},
        headers=team["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "too_many_addresses"
    bulk(client, team, team_id, "a@x.dev b@x.dev c@x.dev", preview=True)

    response = client.post(
        f"/teams/{team_id}/invites/bulk",
        json={"addresses": " ,\n "},
        headers=team["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "no_addresses"


def test_emailed_when_asked_and_refusals_are_reported(client, team, mailer, session):
    mailer.refuse = {"carlos@acme.example"}
    result = bulk(
        client,
        team,
        team["team"]["id"],
        "hana@northwind.dev carlos@acme.example",
        send_email=True,
    )
    assert (result["sent"], result["skipped"], result["failed"]) == (1, 0, 1)
    assert [to for to, _, _ in mailer.sent] == ["hana@northwind.dev"]
    entries = by_email(result)
    [carlos] = entries["carlos@acme.example"]["teams"]
    assert carlos["status"] == "failed"
    assert carlos["reason"] == "mail_refused"
    # The invitation is still there, with its link to copy, and is not
    # claimed to have been emailed.
    assert carlos["invite"]["token"]
    assert carlos["invite"]["emailed_at"] is None
    session.expire_all()
    row = session.exec(
        select(TeamInvite).where(TeamInvite.email == "carlos@acme.example")
    ).one()
    assert row.emailed_at is None
    assert entries["hana@northwind.dev"]["teams"][0]["invite"]["emailed_at"]


def test_the_admin_can_choose_not_to_email(client, team, mailer):
    bulk(client, team, team["team"]["id"], "hana@northwind.dev")
    assert mailer.sent == []


def test_emailing_needs_a_mail_server(client, team):
    response = client.post(
        f"/teams/{team['team']['id']}/invites/bulk",
        json={"addresses": "hana@northwind.dev", "send_email": True},
        headers=team["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "email_not_configured"


def test_an_account_from_outside_is_not_invited_in_bulk(client, team, auth, session):
    auth(email="client@outside.example", full_name="Cleo Client")
    user = session.exec(
        select(User).where(User.email == "client@outside.example")
    ).one()
    user.is_external = True
    session.add(user)
    session.commit()

    result = bulk(client, team, team["team"]["id"], "client@outside.example")
    [outcome] = result["entries"][0]["teams"]
    assert outcome["status"] == "failed"
    assert outcome["reason"] == "account_outside_organisation"
    assert session.exec(select(TeamInvite)).all() == []


def test_a_site_admin_can_create_accounts_from_the_list(client, team, auth, session):
    eng = team["team"]["id"]
    sup = second_team(client, team)
    jonas = auth(email="jonas@northwind.dev", full_name="Jonas Berg")
    client.post(
        f"/teams/{sup}/invites",
        json={"email": "jonas@northwind.dev"},
        headers=team["headers"],
    )

    preview = bulk(
        client,
        team,
        eng,
        "Hana Suzuki <hana@northwind.dev> yuki.sato@northwind.dev jonas@northwind.dev",
        team_ids=[eng, sup],
        create_accounts=True,
        preview=True,
    )
    kinds = {
        email: {r["kind"] for r in entry["teams"]}
        for email, entry in by_email(preview).items()
    }
    assert kinds == {
        "hana@northwind.dev": {"account"},
        "yuki.sato@northwind.dev": {"account"},
        "jonas@northwind.dev": {"add"},
    }

    result = bulk(
        client,
        team,
        eng,
        "Hana Suzuki <hana@northwind.dev> yuki.sato@northwind.dev jonas@northwind.dev",
        team_ids=[eng, sup],
        create_accounts=True,
    )
    assert (result["sent"], result["skipped"], result["failed"]) == (6, 0, 0)
    entries = by_email(result)
    assert entries["hana@northwind.dev"]["welcome_link"].startswith(
        f"{settings.app_base_url}/welcome/"
    )
    assert entries["yuki.sato@northwind.dev"]["name"] == "Yuki Sato"
    assert entries["jonas@northwind.dev"]["welcome_link"] is None

    hana = session.exec(select(User).where(User.email == "hana@northwind.dev")).one()
    assert hana.full_name == "Hana Suzuki"
    assert hana.is_activated is False
    assert len(session.exec(select(PasswordReset)).all()) == 2
    memberships = {
        (m.user_id, m.team_id) for m in session.exec(select(TeamMember)).all()
    }
    for user_id in (hana.id, jonas["user"]["id"]):
        assert {(user_id, eng), (user_id, sup)} <= memberships
    # On the team now, so the invitation to it is spent.
    assert session.exec(select(TeamInvite)).all() == []


def test_only_a_site_admin_creates_accounts(client, team, auth):
    other = auth(email="other@example.com")
    theirs = client.post(
        "/teams", json={"name": "Theirs", "key": "THR"}, headers=other["headers"]
    ).json()["id"]
    response = client.post(
        f"/teams/{theirs}/invites/bulk",
        json={"addresses": "a@example.com", "create_accounts": True},
        headers=other["headers"],
    )
    assert response.status_code == 403
    assert response.json()["code"] == "not_site_admin"
