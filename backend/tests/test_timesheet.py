"""The weekly timesheet (#267): my logged time across teams, by day."""

from datetime import date, timedelta

import pytest

H = 60


def join(client, owner, team_id, person, role="member"):
    response = client.post(
        f"/teams/{team_id}/members",
        json={"email": person["user"]["email"], "role": role},
        headers=owner["headers"],
    )
    assert response.status_code == 200, response.text


def make_team(client, owner, name, key):
    response = client.post(
        "/teams", json={"name": name, "key": key}, headers=owner["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def make_ticket(client, actor, team_id, title="Work", **fields):
    response = client.post(
        f"/teams/{team_id}/tickets",
        json={"title": title, **fields},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def log(client, actor, ticket, minutes, day, expect=200, **fields):
    response = client.post(
        f"/tickets/{ticket['id']}/worklogs",
        json={"minutes": minutes, "worked_on": day.isoformat(), **fields},
        headers=actor["headers"],
    )
    assert response.status_code == expect, response.text
    return response.json()


def cell(client, actor, ticket, day, minutes, expect=200):
    response = client.put(
        f"/tickets/{ticket['id']}/worklogs/days/{day.isoformat()}",
        json={"minutes": minutes},
        headers=actor["headers"],
    )
    assert response.status_code == expect, response.text
    return response.json()


def week(client, actor, start=None, path="/me/worklogs", expect=200, **params):
    query = {**params}
    if start is not None:
        query["from"] = start.isoformat()
    response = client.get(path, params=query, headers=actor["headers"])
    assert response.status_code == expect, response.text
    return response.json()


def entries(client, actor, ticket):
    response = client.get(f"/tickets/{ticket['id']}/worklogs", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()["entries"]


def this_monday() -> date:
    today = date.today()
    return today - timedelta(days=today.weekday())


#: A week that is over, so every weekday in it has started.
PAST = this_monday() - timedelta(days=14)


def by_identifier(sheet):
    return {
        row["ticket"]["identifier"]: [c["minutes"] for c in row["days"]]
        for row in sheet["tickets"]
    }


@pytest.fixture
def daniel(client, team, auth):
    """On Engineering, and running Support of his own."""
    person = auth(email="daniel@softtrack.dev", full_name="Daniel Okafor")
    join(client, team, team["team"]["id"], person)
    return person


@pytest.fixture
def support(client, daniel):
    return make_team(client, daniel, "Support", "SUP")


def test_my_week_is_every_team_i_am_on_in_one_grid(client, team, daniel, support):
    eng = make_ticket(client, team, team["team"]["id"], "Magic link")
    sup = make_ticket(client, daniel, support["id"], "Acme invoices")
    log(client, daniel, eng, 4 * H, PAST)
    log(client, daniel, eng, 3 * H, PAST + timedelta(days=1))
    log(client, daniel, sup, 1 * H, PAST)
    # Somebody else's time on the same ticket is theirs, not his.
    log(client, team, eng, 2 * H, PAST)

    sheet = week(client, daniel, PAST)

    assert sheet["start"] == PAST.isoformat()
    assert sheet["end"] == (PAST + timedelta(days=6)).isoformat()
    assert by_identifier(sheet) == {
        "ENG-1": [4 * H, 3 * H, 0, 0, 0, 0, 0],
        "SUP-1": [1 * H, 0, 0, 0, 0, 0, 0],
    }
    assert [day["minutes"] for day in sheet["days"]] == [5 * H, 3 * H, 0, 0, 0, 0, 0]
    assert sheet["minutes"] == 8 * H
    eng_row = sheet["tickets"][0]["ticket"]
    assert eng_row["team_key"] == "ENG" and eng_row["can_log"] is True
    assert eng_row["title"] == "Magic link"


def test_rows_stay_in_the_order_they_were_first_logged(client, team):
    first = make_ticket(client, team, team["team"]["id"], "First")
    second = make_ticket(client, team, team["team"]["id"], "Second")
    log(client, team, second, 30, PAST + timedelta(days=2))
    log(client, team, first, 30, PAST + timedelta(days=3))
    log(client, team, second, 30, PAST)
    assert list(by_identifier(week(client, team, PAST))) == ["ENG-2", "ENG-1"]


def test_this_week_by_default_in_the_instances_timezone(client, team, monkeypatch):
    from lib_softtrack.timesheet import today_for
    from web import settings

    monkeypatch.setattr(settings, "default_timezone", "Pacific/Auckland")
    sheet = week(client, team)
    today = today_for(None)
    monday = today - timedelta(days=today.weekday())
    assert sheet["today"] == today.isoformat()
    assert sheet["start"] == monday.isoformat()
    assert sheet["end"] == (monday + timedelta(days=6)).isoformat()
    assert len(sheet["days"]) == 7


def test_any_range_up_to_a_year(client, team):
    sheet = week(client, team, PAST, to=(PAST + timedelta(days=30)).isoformat())
    assert len(sheet["days"]) == 31

    for to in (PAST - timedelta(days=1), PAST + timedelta(days=366)):
        refused = week(client, team, PAST, expect=400, to=to.isoformat())
        assert refused["code"] == "timesheet_range_invalid"


def test_time_on_a_team_i_have_left_is_not_in_my_week(client, team, daniel, support):
    sup = make_ticket(client, daniel, support["id"])
    log(client, daniel, sup, 1 * H, PAST)
    join(client, daniel, support["id"], team)
    log(client, team, sup, 2 * H, PAST)
    assert by_identifier(week(client, team, PAST)) == {"SUP-1": [2 * H] + [0] * 6}

    left = client.delete(
        f"/teams/{support['id']}/members/{team['user']['id']}",
        headers=team["headers"],
    )
    assert left.status_code == 204, left.text
    assert week(client, team, PAST)["tickets"] == []


def test_time_on_a_ticket_in_the_trash_is_not_counted(client, team):
    ticket = make_ticket(client, team, team["team"]["id"])
    log(client, team, ticket, 2 * H, PAST)
    deleted = client.delete(f"/tickets/{ticket['id']}", headers=team["headers"])
    assert deleted.status_code == 204, deleted.text
    sheet = week(client, team, PAST)
    assert sheet["tickets"] == [] and sheet["minutes"] == 0


def test_a_ticket_joins_the_week_by_being_added(client, team, auth):
    ticket = make_ticket(client, team, team["team"]["id"], "Not logged yet")
    stranger = auth(email="other@softtrack.dev", full_name="Other Person")
    theirs = make_team(client, stranger, "Elsewhere", "ELS")
    hidden = make_ticket(client, stranger, theirs["id"], "Not mine to see")

    sheet = week(client, team, PAST, ticket_id=[ticket["id"], hidden["id"]])

    assert by_identifier(sheet) == {"ENG-1": [0] * 7}
    assert "Not mine to see" not in str(sheet)


def test_a_guest_sees_their_rows_and_cannot_type_in_them(client, team, daniel):
    ticket = make_ticket(client, team, team["team"]["id"])
    log(client, daniel, ticket, 1 * H, PAST)
    client.patch(
        f"/teams/{team['team']['id']}/members/{daniel['user']['id']}",
        json={"role": "guest"},
        headers=team["headers"],
    )
    row = week(client, daniel, PAST)["tickets"][0]
    assert row["ticket"]["can_log"] is False
    refused = cell(client, daniel, ticket, PAST, 2 * H, expect=403)
    assert refused["code"] == "team_read_only"


# --- marked days -------------------------------------------------------------


def test_a_weekday_with_nothing_logged_is_marked(client, team):
    ticket = make_ticket(client, team, team["team"]["id"])
    for offset in range(4):  # Monday to Thursday; Friday is empty
        log(client, team, ticket, 7 * H, PAST + timedelta(days=offset))
    days = week(client, team, PAST)["days"]
    assert [day["nothing_logged"] for day in days] == [
        False,
        False,
        False,
        False,
        True,
        # The weekend says nothing.
        False,
        False,
    ]


def test_days_still_to_come_are_not_marked(client, team):
    days = week(client, team, this_monday() + timedelta(days=7))["days"]
    assert not any(day["nothing_logged"] for day in days)


def test_a_long_day_is_marked(client, team, monkeypatch):
    from web import settings

    monkeypatch.setattr(settings, "timesheet_long_day_hours", 8)
    eng = make_ticket(client, team, team["team"]["id"])
    other = make_ticket(client, team, team["team"]["id"])
    log(client, team, eng, 6 * H, PAST)
    log(client, team, other, 2 * H, PAST)  # 8h: not over
    log(client, team, eng, 6 * H, PAST + timedelta(days=1))
    log(client, team, other, 3 * H, PAST + timedelta(days=1))  # 9h: over

    sheet = week(client, team, PAST)
    assert sheet["long_day_minutes"] == 8 * H
    assert [day["over"] for day in sheet["days"][:2]] == [False, True]


# --- typing in a cell ----------------------------------------------------------


def test_typing_in_an_empty_cell_logs_time(client, team):
    ticket = make_ticket(client, team, team["team"]["id"])
    assert cell(client, team, ticket, PAST, 90) == {
        "day": PAST.isoformat(),
        "minutes": 90,
    }
    [entry] = entries(client, team, ticket)
    assert entry["minutes"] == 90 and entry["worked_on"] == PAST.isoformat()
    assert entry["user"]["id"] == team["user"]["id"]


def test_typing_in_a_cell_changes_its_entry(client, team):
    ticket = make_ticket(client, team, team["team"]["id"])
    logged = log(client, team, ticket, 1 * H, PAST, note="Pairing")
    cell(client, team, ticket, PAST, 3 * H)
    [entry] = entries(client, team, ticket)
    assert entry["id"] == logged["id"]
    assert entry["minutes"] == 3 * H and entry["note"] == "Pairing"


def test_a_cell_over_several_entries_keeps_the_oldest(client, team):
    ticket = make_ticket(client, team, team["team"]["id"])
    oldest = log(client, team, ticket, 2 * H, PAST)
    log(client, team, ticket, 1 * H, PAST)
    newest = log(client, team, ticket, 1 * H, PAST)

    cell(client, team, ticket, PAST, 5 * H)  # more: the newest takes it
    assert sorted(e["minutes"] for e in entries(client, team, ticket)) == [
        1 * H,
        2 * H,
        2 * H,
    ]
    cell(client, team, ticket, PAST, 90)  # less than the oldest: it alone is left
    [entry] = entries(client, team, ticket)
    assert entry["id"] == oldest["id"] and entry["minutes"] == 90
    assert newest["id"] != oldest["id"]


def test_emptying_a_cell_removes_its_entries(client, team):
    ticket = make_ticket(client, team, team["team"]["id"])
    log(client, team, ticket, 2 * H, PAST)
    log(client, team, ticket, 1 * H, PAST)
    cell(client, team, ticket, PAST, 0)
    assert entries(client, team, ticket) == []
    assert week(client, team, PAST)["tickets"] == []


def test_a_cell_only_ever_touches_my_own_time(client, team, daniel):
    ticket = make_ticket(client, team, team["team"]["id"])
    log(client, team, ticket, 2 * H, PAST)
    cell(client, daniel, ticket, PAST, 1 * H)
    cell(client, daniel, ticket, PAST, 0)
    [entry] = entries(client, team, ticket)
    assert entry["user"]["id"] == team["user"]["id"] and entry["minutes"] == 2 * H


def test_a_cell_follows_the_tickets_rules(client, team, auth):
    ticket = make_ticket(client, team, team["team"]["id"])
    later = date.today() + timedelta(days=3)
    assert cell(client, team, ticket, later, 60, expect=400)["code"] == (
        "worklog_in_future"
    )
    stranger = auth(email="other@softtrack.dev", full_name="Other Person")
    assert cell(client, stranger, ticket, PAST, 60, expect=403)["code"] == (
        "not_team_member"
    )
    cell(client, team, ticket, PAST, 24 * H + 1, expect=422)


def test_logging_from_the_grid_takes_it_off_what_is_left(client, team):
    """Remaining set by hand (#268) goes down as it does from the ticket."""
    ticket = make_ticket(client, team, team["team"]["id"])
    client.patch(
        f"/tickets/{ticket['id']}",
        json={"time_estimate_minutes": 10 * H, "remaining_minutes": 5 * H},
        headers=team["headers"],
    )
    cell(client, team, ticket, PAST, 2 * H)
    estimate = client.get(
        f"/tickets/{ticket['id']}/time-estimate", headers=team["headers"]
    ).json()
    assert estimate["remaining_minutes"] == 3 * H


# --- a row per person ----------------------------------------------------------


def test_a_teams_week_has_a_row_per_person_for_its_admins(
    client, team, daniel, support, auth
):
    eng_id = team["team"]["id"]
    guest = auth(email="guest@example.com", full_name="Carol Client")
    join(client, team, eng_id, guest, role="guest")
    eng = make_ticket(client, team, eng_id)
    sup = make_ticket(client, daniel, support["id"])
    log(client, team, eng, 6 * H, PAST)
    log(client, daniel, eng, 7 * H, PAST)
    log(client, daniel, eng, 2 * H, PAST + timedelta(days=1))
    # His time on Support is not Engineering's.
    log(client, daniel, sup, 4 * H, PAST + timedelta(days=1))

    sheet = week(client, team, PAST, path=f"/teams/{eng_id}/worklogs")

    assert sheet["team"]["key"] == "ENG"
    rows = {
        row["person"]["full_name"]: [c["minutes"] for c in row["days"]][:3]
        for row in sheet["people"]
    }
    # Everybody who can log time on it, guests not; ordered by name.
    assert rows == {"Daniel Okafor": [7 * H, 2 * H, 0], "Demo User": [6 * H, 0, 0]}
    assert sheet["minutes"] == 15 * H
    tuesday = sheet["days"][1]
    assert tuesday["nothing_logged"] is True
    assert [p["full_name"] for p in tuesday["people_without_time"]] == ["Demo User"]

    refused = week(client, daniel, PAST, path=f"/teams/{eng_id}/worklogs", expect=403)
    assert refused["code"] == "not_team_admin"


def test_my_week_says_which_other_weeks_i_can_open(client, team, daniel, support):
    mine = week(client, daniel, PAST)
    assert [t["key"] for t in mine["teams_i_run"]] == ["SUP"]
    assert mine["has_reports"] is False

    client.patch(
        f"/admin/users/{daniel['user']['id']}",
        json={"manager_id": team["user"]["id"]},
        headers=team["headers"],
    )
    assert week(client, team, PAST)["has_reports"] is True


def test_a_manager_sees_their_reports_on_the_teams_they_share(
    client, team, daniel, support, auth
):
    # Demo (the first account, a site admin) manages Daniel and Kenji; Kenji
    # is on no team with Demo, and Mei reports to nobody.
    kenji = auth(email="kenji@softtrack.dev", full_name="Kenji Mori")
    mei = auth(email="mei@softtrack.dev", full_name="Mei Tanaka")
    join(client, team, team["team"]["id"], mei)
    for report in (daniel, kenji):
        response = client.patch(
            f"/admin/users/{report['user']['id']}",
            json={"manager_id": team["user"]["id"]},
            headers=team["headers"],
        )
        assert response.status_code == 200, response.text
    eng = make_ticket(client, team, team["team"]["id"])
    sup = make_ticket(client, daniel, support["id"], "Support's secret")
    log(client, daniel, eng, 3 * H, PAST)
    log(client, daniel, sup, 5 * H, PAST)
    log(client, mei, eng, 1 * H, PAST)

    sheet = week(client, team, PAST, path="/me/reports/worklogs")

    assert [row["person"]["full_name"] for row in sheet["people"]] == ["Daniel Okafor"]
    # Support is not a team the manager is on: its time is not theirs to see.
    assert sheet["people"][0]["minutes"] == 3 * H
    assert sheet["team"] is None

    nobody = week(client, mei, PAST, path="/me/reports/worklogs")
    assert nobody["people"] == []


# --- CSV -------------------------------------------------------------------------


def test_my_time_exports_as_csv(client, team, daniel, support):
    eng = make_ticket(client, team, team["team"]["id"], "=HYPERLINK(1)")
    sup = make_ticket(client, daniel, support["id"], "Acme invoices")
    log(client, daniel, eng, 90, PAST + timedelta(days=1), note="Pairing")
    log(client, daniel, sup, 60, PAST)
    log(client, daniel, sup, 60, PAST - timedelta(days=1))  # outside the range

    response = client.get(
        "/me/worklogs/export",
        params={"from": PAST.isoformat(), "to": (PAST + timedelta(days=6)).isoformat()},
        headers=daniel["headers"],
    )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    assert f"my-time-{PAST.isoformat()}" in response.headers["content-disposition"]
    lines = response.content.decode("utf-8-sig").split("\r\n")
    assert lines[0] == "date,person,team,ticket,title,hours,note"
    assert lines[1:] == [
        f"{PAST.isoformat()},Daniel Okafor,SUP,SUP-1,Acme invoices,1,",
        f"{(PAST + timedelta(days=1)).isoformat()},Daniel Okafor,ENG,ENG-1,"
        "'=HYPERLINK(1),1.5,Pairing",
        "",
    ]


def test_a_teams_time_exports_for_its_admins(client, team, daniel):
    eng = make_ticket(client, team, team["team"]["id"])
    log(client, daniel, eng, 30, PAST)
    path = f"/teams/{team['team']['id']}/worklogs/export"
    params = {"from": PAST.isoformat()}
    response = client.get(path, params=params, headers=team["headers"])
    assert response.status_code == 200, response.text
    assert "Daniel Okafor" in response.content.decode("utf-8-sig")
    assert client.get(path, params=params, headers=daniel["headers"]).status_code == 403
