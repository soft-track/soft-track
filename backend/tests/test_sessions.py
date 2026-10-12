"""Where an account is signed in, each session revocable (#308)."""

from datetime import timedelta

import pytest
from sqlmodel import select

from lib_identity import sessions as sessions_service
from lib_softtrack import realtime
from lib_softtrack.tables import AuthSession, PasswordReset, User, utcnow
from lib_utils.token import create_access_token
from web import settings

FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"
SAFARI_IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)
CHROME_WINDOWS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
)
EDGE_WINDOWS = CHROME_WINDOWS + " Edg/129.0.0.0"


def sign_in(client, email, user_agent=FIREFOX_LINUX, password="password123"):
    response = client.post(
        "/auth/login",
        data={"username": email, "password": password},
        headers={"User-Agent": user_agent},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def listed(client, headers):
    response = client.get("/auth/me/sessions", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


class FakeMailer:
    def __init__(self):
        self.sent: list[tuple[str, str, str]] = []

    def send(self, to: str, subject: str, body: str) -> None:
        self.sent.append((to, subject, body))


@pytest.fixture
def mailer(monkeypatch):
    fake = FakeMailer()
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(sessions_service, "get_mailer", lambda: fake)
    return fake


# --- what a session is --------------------------------------------------------


@pytest.mark.parametrize(
    "agent, expected",
    [
        (FIREFOX_LINUX, ("Firefox", "Linux")),
        (SAFARI_IPHONE, ("Safari", "iPhone")),
        (CHROME_WINDOWS, ("Chrome", "Windows")),
        (EDGE_WINDOWS, ("Edge", "Windows")),
        (
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
            ("Chrome", "Android"),
        ),
        (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/18.0 Safari/605.1.15",
            ("Safari", "macOS"),
        ),
        ("curl/8.5.0", (None, None)),
        ("", (None, None)),
    ],
)
def test_a_user_agent_is_read_as_a_browser_and_a_system(agent, expected):
    assert sessions_service.describe(agent) == expected


def test_signing_in_makes_a_session_with_its_browser_and_address(client, auth):
    auth(email="amina@example.com")
    headers = sign_in(client, "amina@example.com")

    rows = listed(client, headers)
    # Registering signed in too: that is the other row.
    assert len(rows) == 2
    this = rows[0]
    assert this["current"] is True
    assert (this["browser"], this["system"]) == ("Firefox", "Linux")
    assert this["ip_address"] == "testclient"
    assert this["created_at"] and this["last_used_at"]
    assert rows[1]["current"] is False


def test_the_token_carries_the_session(client, auth, session):
    from lib_utils.token import decode_access_token

    auth(email="amina@example.com")
    headers = sign_in(client, "amina@example.com")
    claims = decode_access_token(headers["Authorization"].split()[1])
    row = session.get(AuthSession, claims["sid"])
    assert row is not None and row.user_agent == FIREFOX_LINUX


# --- revoking one -------------------------------------------------------------


def test_revoking_one_refuses_it_and_the_others_continue(client, auth):
    auth(email="amina@example.com")
    laptop = sign_in(client, "amina@example.com")
    phone = sign_in(client, "amina@example.com", SAFARI_IPHONE)
    office = sign_in(client, "amina@example.com", CHROME_WINDOWS)

    phone_id = next(r["id"] for r in listed(client, phone) if r["current"])
    response = client.delete(f"/auth/me/sessions/{phone_id}", headers=laptop)
    assert response.status_code == 204

    assert client.get("/auth/me", headers=phone).status_code == 401
    assert client.get("/auth/me", headers=laptop).status_code == 200
    assert client.get("/auth/me", headers=office).status_code == 200
    assert phone_id not in [r["id"] for r in listed(client, laptop)]

    # Gone is gone: a second revoke finds nothing.
    again = client.delete(f"/auth/me/sessions/{phone_id}", headers=laptop)
    assert again.status_code == 404
    assert again.json()["code"] == "session_not_found"


def test_nobody_revokes_somebody_elses_session(client, auth):
    auth(email="amina@example.com")
    auth(email="mallory@example.com")
    amina = sign_in(client, "amina@example.com")
    mallory = sign_in(client, "mallory@example.com")
    amina_id = next(r["id"] for r in listed(client, amina) if r["current"])

    response = client.delete(f"/auth/me/sessions/{amina_id}", headers=mallory)
    assert response.status_code == 404
    assert client.get("/auth/me", headers=amina).status_code == 200


def test_signing_out_ends_this_session(client, auth):
    auth(email="amina@example.com")
    laptop = sign_in(client, "amina@example.com")
    phone = sign_in(client, "amina@example.com", SAFARI_IPHONE)
    before = len(listed(client, laptop))

    assert client.post("/auth/sign-out", headers=phone).status_code == 204
    assert client.get("/auth/me", headers=phone).status_code == 401
    assert len(listed(client, laptop)) == before - 1


def test_revoking_one_closes_its_streams_and_no_others(
    client, auth, monkeypatch, session
):
    realtime.install()
    sent = []

    class Recording:
        def publish(self, channel, event):
            sent.append((channel, event.name))

    monkeypatch.setattr(realtime, "bus", Recording())
    auth(email="amina@example.com")
    laptop = sign_in(client, "amina@example.com")
    phone = sign_in(client, "amina@example.com", SAFARI_IPHONE)
    phone_id = next(r["id"] for r in listed(client, phone) if r["current"])
    sent.clear()

    client.delete(f"/auth/me/sessions/{phone_id}", headers=laptop)
    assert sent == [(f"session:{phone_id}", "close")]


# --- everywhere, and what else ends them -------------------------------------


def test_sign_out_everywhere_ends_the_others_and_keeps_this_one(client, auth):
    auth(email="amina@example.com")
    laptop = sign_in(client, "amina@example.com")
    phone = sign_in(client, "amina@example.com", SAFARI_IPHONE)
    laptop_id = next(r["id"] for r in listed(client, laptop) if r["current"])

    response = client.post("/auth/me/sign-out-everywhere", headers=laptop)
    kept = {"Authorization": f"Bearer {response.json()['access_token']}"}

    assert client.get("/auth/me", headers=phone).status_code == 401
    rows = listed(client, kept)
    # The same row, still this device: it was not signed in again.
    assert [(r["id"], r["current"]) for r in rows] == [(laptop_id, True)]


def test_changing_the_password_ends_the_others_and_keeps_this_one(client, auth):
    auth(email="amina@example.com")
    laptop = sign_in(client, "amina@example.com")
    phone = sign_in(client, "amina@example.com", SAFARI_IPHONE)

    response = client.post(
        "/auth/me/password",
        json={"current_password": "password123", "new_password": "brand-new-pw"},
        headers=laptop,
    )
    assert response.status_code == 200
    kept = {"Authorization": f"Bearer {response.json()['access_token']}"}
    assert client.get("/auth/me", headers=phone).status_code == 401
    assert len(listed(client, kept)) == 1


def test_a_session_unused_for_thirty_days_ends(client, auth, session):
    auth(email="amina@example.com")
    laptop = sign_in(client, "amina@example.com")
    phone = sign_in(client, "amina@example.com", SAFARI_IPHONE)
    phone_id = next(r["id"] for r in listed(client, phone) if r["current"])

    row = session.get(AuthSession, phone_id)
    row.last_used_at = utcnow() - timedelta(days=30, minutes=1)
    session.add(row)
    session.commit()

    assert phone_id not in [r["id"] for r in listed(client, laptop)]
    assert client.get("/auth/me", headers=phone).status_code == 401


def test_last_used_is_written_at_most_once_a_minute(client, auth, session):
    auth(email="amina@example.com")
    laptop = sign_in(client, "amina@example.com")
    row_id = next(r["id"] for r in listed(client, laptop) if r["current"])
    row = session.get(AuthSession, row_id)

    earlier = utcnow() - timedelta(seconds=30)
    row.last_used_at = earlier
    session.add(row)
    session.commit()
    client.get("/auth/me", headers=laptop)
    session.refresh(row)
    assert row.last_used_at.replace(tzinfo=None) == earlier.replace(tzinfo=None)

    row.last_used_at = utcnow() - timedelta(hours=2)
    session.add(row)
    session.commit()
    client.get("/auth/me", headers=laptop)
    session.refresh(row)
    assert row.last_used_at.replace(tzinfo=None) > earlier.replace(tzinfo=None)


def test_a_token_from_before_sessions_keeps_working(client, auth):
    actor = auth(email="amina@example.com")
    old = create_access_token(subject=str(actor["user"]["id"]), version=0)
    headers = {"Authorization": f"Bearer {old}"}
    assert client.get("/auth/me", headers=headers).status_code == 200
    # It is not one of the sessions, so nothing is "this device".
    assert not any(r["current"] for r in listed(client, headers))


def test_a_token_naming_no_such_session_is_refused(client, auth):
    actor = auth(email="amina@example.com")
    forged = create_access_token(
        subject=str(actor["user"]["id"]), version=0, session_id=99999
    )
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {forged}"})
    assert response.status_code == 401


def test_api_tokens_are_not_sessions(client, auth):
    actor = auth(email="amina@example.com")
    created = client.post(
        "/auth/me/tokens", json={"name": "CI"}, headers=actor["headers"]
    ).json()
    script = {"Authorization": f"Bearer {created['token']}"}

    assert len(listed(client, actor["headers"])) == 1
    # And a token cannot see or end the sessions.
    assert client.get("/auth/me/sessions", headers=script).status_code == 403
    assert client.delete("/auth/me/sessions/1", headers=script).status_code == 403
    # Signing out everywhere leaves it working, as before.
    client.post("/auth/me/sign-out-everywhere", headers=actor["headers"])
    assert client.get("/auth/me", headers=script).status_code == 200


# --- a site admin -------------------------------------------------------------


def directory_row(client, admin, email):
    rows = client.get("/admin/users", headers=admin["headers"]).json()["items"]
    return next(r for r in rows if r["email"] == email)


def test_a_site_admin_sees_the_count_and_ends_them_all(client, auth):
    admin = auth(email="admin@example.com")
    amina = auth(email="amina@example.com")
    phone = sign_in(client, "amina@example.com", SAFARI_IPHONE)
    sign_in(client, "amina@example.com", CHROME_WINDOWS)

    row = directory_row(client, admin, "amina@example.com")
    assert row["session_count"] == 3
    assert row["last_login_at"]

    response = client.post(
        f"/admin/users/{amina['user']['id']}/end-sessions", headers=admin["headers"]
    )
    assert response.status_code == 200
    assert response.json()["session_count"] == 0
    assert client.get("/auth/me", headers=phone).status_code == 401
    assert client.get("/auth/me", headers=amina["headers"]).status_code == 401
    assert directory_row(client, admin, "amina@example.com")["session_count"] == 0


def test_only_a_site_admin_ends_somebodys_sessions(client, auth):
    auth(email="admin@example.com")
    amina = auth(email="amina@example.com")
    mallory = auth(email="mallory@example.com")
    response = client.post(
        f"/admin/users/{amina['user']['id']}/end-sessions",
        headers=mallory["headers"],
    )
    assert response.status_code == 403
    assert client.get("/auth/me", headers=amina["headers"]).status_code == 200


def test_ending_sessions_spares_a_welcome_link(client, auth, session):
    admin = auth(email="admin@example.com")
    created = client.post(
        "/admin/users",
        json={"full_name": "Yuki Sato", "email": "yuki@example.com"},
        headers=admin["headers"],
    ).json()
    user_id = created["user"]["id"]
    response = client.post(
        f"/admin/users/{user_id}/end-sessions", headers=admin["headers"]
    )
    assert response.status_code == 200
    link = session.exec(
        select(PasswordReset).where(PasswordReset.user_id == user_id)
    ).one()
    assert link.token_version == session.get(User, user_id).token_version


def test_deactivating_ends_the_sessions_in_the_count(client, auth):
    admin = auth(email="admin@example.com")
    amina = auth(email="amina@example.com")
    client.patch(
        f"/admin/users/{amina['user']['id']}",
        json={"is_active": False},
        headers=admin["headers"],
    )
    assert directory_row(client, admin, "amina@example.com")["session_count"] == 0


# --- an email on a new browser -----------------------------------------------


def test_a_new_browser_is_announced_by_email(client, auth, mailer):
    auth(email="amina@example.com", full_name="Amina Khan")
    sign_in(client, "amina@example.com", CHROME_WINDOWS)

    [(to, subject, body)] = mailer.sent
    assert to == "amina@example.com"
    assert subject == "A new sign-in to your SoftTrack account"
    assert "Chrome on Windows signed in on " in body
    assert "from testclient. If that was you, there is nothing to do." in body
    assert "/settings/security" in body


def test_a_mail_server_that_is_down_does_not_fail_the_sign_in(
    client, auth, monkeypatch, caplog
):
    # The email goes out after the response. When it fails, there is nobody
    # left to tell -- and raising there dropped the connection, so a mail host
    # that was down or misspelt stopped everyone signing in from a new browser.
    class DownMailer:
        def send(self, to, subject, body):
            raise OSError("Name or service not known")

    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(sessions_service, "get_mailer", lambda: DownMailer())
    auth(email="amina@example.com")

    headers = sign_in(client, "amina@example.com", CHROME_WINDOWS)

    assert len(listed(client, headers)) == 2
    assert "Could not send 'A new sign-in to your SoftTrack account'" in caplog.text


def test_a_browser_used_before_is_not_announced(client, auth, mailer):
    # Registering was the first session: nothing to compare it with.
    auth(email="amina@example.com")
    assert mailer.sent == []
    sign_in(client, "amina@example.com", CHROME_WINDOWS)
    sign_in(client, "amina@example.com", CHROME_WINDOWS)
    assert len(mailer.sent) == 1


def test_the_first_sign_in_after_this_exists_is_not_announced(
    client, auth, mailer, session
):
    auth(email="amina@example.com")
    # An account from before sessions: no rows at all.
    for row in session.exec(select(AuthSession)).all():
        session.delete(row)
    session.commit()
    sign_in(client, "amina@example.com", CHROME_WINDOWS)
    assert mailer.sent == []


def test_old_rows_are_swept_at_the_next_sign_in(client, auth, session):
    actor = auth(email="amina@example.com")
    row = session.exec(select(AuthSession)).one()
    swept_id = row.id
    row.last_used_at = utcnow() - timedelta(days=91)
    session.add(row)
    session.commit()
    sign_in(client, "amina@example.com")
    rows = session.exec(
        select(AuthSession).where(AuthSession.user_id == actor["user"]["id"])
    ).all()
    assert len(rows) == 1
    # Its id is not handed on: the old token names a session that is gone.
    assert rows[0].id != swept_id
    assert client.get("/auth/me", headers=actor["headers"]).status_code == 401
