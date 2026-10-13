"""Who created a ticket, what I watch, when it changed, what it has none of,
and "me" as a value (#261).

The ticket list, its export, search and a share link all read these through
`lib_softtrack/filters.py`, so most of this is asked of the list and once of
each of the others.
"""

import csv
import io
from datetime import date, datetime, timedelta, timezone

import pytest

from lib_softtrack.tables import Ticket, TicketWatch

TODAY = date(2026, 10, 12)


def _ok(response):
    assert response.status_code in (200, 201), response.text
    return response.json()


@pytest.fixture
def desk(client, team, auth, session):
    """Two people on a team. Amina (the owner) filed three tickets and Mei
    one; Mei watches one of Amina's. One was last touched 45 days ago, one 10
    days ago, the rest today; one has an estimate, an epic and a sprint."""
    team_id = team["team"]["id"]
    mei = auth(email="mei@softtrack.dev", full_name="Mei Tanaka")
    _ok(
        client.post(
            f"/teams/{team_id}/members",
            json={"email": "mei@softtrack.dev"},
            headers=team["headers"],
        )
    )
    epic = _ok(
        client.post(
            f"/teams/{team_id}/projects",
            json={"name": "Portal"},
            headers=team["headers"],
        )
    )
    sprint = _ok(
        client.post(
            f"/teams/{team_id}/sprints",
            json={"starts_at": "2026-10-05", "ends_at": "2026-10-19"},
            headers=team["headers"],
        )
    )

    def ticket(actor, title, **fields):
        return _ok(
            client.post(
                f"/teams/{team_id}/tickets",
                json={"title": title, **fields},
                headers=actor["headers"],
            )
        )

    stale = ticket(team, "stale", assignee_id=mei["user"]["id"])
    recent = ticket(team, "recent")
    planned = ticket(
        team,
        "planned",
        estimate=3,
        project_id=epic["id"],
        sprint_id=sprint["id"],
        assignee_id=team["user"]["id"],
    )
    mine = ticket(mei, "mei's")
    # Mei follows "recent" without having touched it.
    session.add(TicketWatch(ticket_id=recent["id"], user_id=mei["user"]["id"]))

    now = datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc)
    for row, days in ((stale, 45), (recent, 10), (planned, 0), (mine, 0)):
        ticket_row = session.get(Ticket, row["id"])
        ticket_row.updated_at = now - timedelta(days=days)
        ticket_row.created_at = now - timedelta(days=days + 5)
        session.add(ticket_row)
    session.commit()

    return {**team, "team_id": team_id, "mei": mei, "epic": epic, "sprint": sprint}


def titles(client, desk, query="", actor=None, path="tickets"):
    actor = actor or desk
    response = client.get(
        f"/teams/{desk['team_id']}/{path}?today={TODAY}&{query}",
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    if path == "tickets/export":
        rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
        return sorted(row[1] for row in rows[1:])
    return sorted(item["title"] for item in response.json()["items"])


def test_created_by_one_or_several_or_everyone_else(client, desk):
    amina, mei = desk["user"]["id"], desk["mei"]["user"]["id"]
    assert titles(client, desk, f"creator_id={mei}") == ["mei's"]
    assert titles(client, desk, f"creator_id={mei}&creator_id={amina}") == [
        "mei's",
        "planned",
        "recent",
        "stale",
    ]
    assert titles(client, desk, f"creator_id={mei}&creator_exclude=true") == [
        "planned",
        "recent",
        "stale",
    ]


def test_me_is_whoever_asks(client, desk):
    """One query, two people, two answers: what a shared view saved as
    "assigned to me" needs to show each viewer their own tickets."""
    assert titles(client, desk, "assignee_me=true") == ["planned"]
    assert titles(client, desk, "assignee_me=true", actor=desk["mei"]) == ["stale"]
    assert titles(client, desk, "creator_me=true", actor=desk["mei"]) == ["mei's"]
    # Me, or nobody; and everyone except me.
    assert titles(client, desk, "assignee_me=true&unassigned=true") == [
        "mei's",
        "planned",
        "recent",
    ]
    assert titles(
        client, desk, "assignee_me=true&assignee_exclude=true", actor=desk["mei"]
    ) == ["mei's", "planned", "recent"]


def test_watching_is_the_viewers_own(client, desk):
    # Amina watches what she filed; Mei what she filed, was given, or follows.
    assert titles(client, desk, "watching=true") == ["planned", "recent", "stale"]
    assert titles(client, desk, "watching=true", actor=desk["mei"]) == [
        "mei's",
        "recent",
        "stale",
    ]


def test_an_unwatched_ticket_is_not_watched(client, desk):
    stale = next(
        item
        for item in client.get(
            f"/teams/{desk['team_id']}/tickets", headers=desk["headers"]
        ).json()["items"]
        if item["title"] == "stale"
    )
    _ok(
        client.put(
            f"/tickets/{stale['id']}/watch",
            json={"watching": False},
            headers=desk["headers"],
        )
    )
    assert titles(client, desk, "watching=true") == ["planned", "recent"]


def test_updated_in_a_window_from_the_viewers_today(client, desk):
    assert titles(client, desk, "updated=last_7_days") == ["mei's", "planned"]
    assert titles(client, desk, "updated=last_30_days") == [
        "mei's",
        "planned",
        "recent",
    ]
    assert titles(client, desk, "updated=over_30_days") == ["stale"]


def test_updated_between_dates_includes_both_ends(client, desk):
    # "recent" was updated on 2 October, "stale" on 28 August.
    assert titles(client, desk, "updated_from=2026-10-02&updated_to=2026-10-02") == [
        "recent"
    ]
    assert titles(client, desk, "updated_to=2026-10-02") == ["recent", "stale"]
    assert titles(client, desk, "updated_from=2026-10-03") == ["mei's", "planned"]


def test_created_the_same_way(client, desk):
    # Each was created five days before it was last updated.
    assert titles(client, desk, "created=last_7_days") == ["mei's", "planned"]
    assert titles(client, desk, "created=over_30_days") == ["stale"]
    assert titles(client, desk, "created_to=2026-09-27") == ["recent", "stale"]


def test_a_range_that_runs_backwards_is_refused(client, desk):
    response = client.get(
        f"/teams/{desk['team_id']}/tickets?updated_from=2026-10-05&updated_to=2026-10-01",
        headers=desk["headers"],
    )
    assert response.status_code == 422


def test_has_no_estimate_epic_or_sprint(client, desk):
    everything_else = ["mei's", "recent", "stale"]
    assert titles(client, desk, "has_no=estimate") == everything_else
    assert titles(client, desk, "has_no=epic") == everything_else
    assert titles(client, desk, "has_no=sprint") == everything_else
    # Each one asked narrows further, as every filter does.
    assert titles(client, desk, "has_no=estimate&updated=over_30_days") == ["stale"]


def test_the_export_takes_the_new_filters(client, desk):
    assert titles(
        client, desk, "updated=over_30_days&has_no=estimate", path="tickets/export"
    ) == ["stale"]


def test_a_saved_view_keeps_them_and_me_stays_me(client, desk):
    filters = {
        "assignee_me": True,
        "creator_id": [desk["user"]["id"]],
        "watching": True,
        "updated": "last_30_days",
        "created_from": "2026-01-01",
        "has_no": ["estimate", "sprint"],
    }
    view = _ok(
        client.post(
            f"/teams/{desk['team_id']}/views",
            json={"name": "Mine, lately", "is_shared": True, "filters": filters},
            headers=desk["headers"],
        )
    )
    # Mei reads the view Amina saved: "me" is not Amina's id.
    seen = _ok(
        client.get(f"/teams/{desk['team_id']}/views", headers=desk["mei"]["headers"])
    )
    read = next(item for item in seen["items"] if item["id"] == view["id"])
    assert read["filters"]["assignee_me"] is True
    assert read["filters"]["assignee_id"] == []
    for key, value in filters.items():
        assert read["filters"][key] == value
    assert read["filters"]["created_to"] is None


def test_a_saved_view_refuses_a_creator_from_elsewhere(client, desk, auth):
    stranger = auth(email="stranger@softtrack.dev", full_name="Stranger")
    response = client.post(
        f"/teams/{desk['team_id']}/views",
        json={"name": "Theirs", "filters": {"creator_id": [stranger["user"]["id"]]}},
        headers=desk["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "user_not_on_team"


def test_a_share_link_reads_me_as_whoever_made_it(client, desk):
    """Nobody is signed in to read a link, so "me" is its maker: the view as
    they saw it, not an empty one."""
    view = _ok(
        client.post(
            f"/teams/{desk['team_id']}/views",
            json={"name": "Mine", "is_shared": True, "filters": {"assignee_me": True}},
            headers=desk["headers"],
        )
    )
    link = _ok(
        client.post(
            f"/teams/{desk['team_id']}/share-links",
            json={"view_id": view["id"]},
            headers=desk["headers"],
        )
    )
    page = _ok(client.get(f"/shared/{link['token']}"))
    assert [ticket["title"] for ticket in page["tickets"]] == ["planned"]


def search(client, actor, q, **params):
    response = client.get(
        "/search",
        params={"q": q, "today": TODAY.isoformat(), **params},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return sorted(hit["title"] for hit in response.json()["items"])


def test_search_takes_the_same_filters(client, desk):
    assert search(client, desk, "stale") == ["stale"]
    assert search(client, desk, "stale", updated="last_30_days") == []
    assert search(client, desk, "planned", has_no="estimate") == []
    assert search(client, desk, "mei", creator_me="true") == []
    assert search(client, desk["mei"], "mei", creator_me="true") == ["mei's"]


def test_search_filters_narrow_and_never_widen(client, desk, auth):
    """A filter on another team's person reaches nothing of theirs: the
    caller's teams stay the scope."""
    outsider = auth(email="else@softtrack.dev", full_name="Elsewhere")
    assert search(client, outsider, "stale", creator_id=desk["user"]["id"]) == []
