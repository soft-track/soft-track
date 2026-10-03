"""WIP limits on board columns (#270).

A status can say how many tickets it should hold. By default the board warns
when a column goes over and the move goes ahead; where the team makes limits
hard, every way a ticket changes status into a full column is refused with a
sentence -- an edit, the board's move, bulk edit, a new ticket, a transfer --
and an automation rule skips the move and says so in its run log.
"""

import pytest

from tests.conftest import status_ids


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def board(client, team):
    """Engineering, In Progress limited to 2 and holding 2."""
    team_id = team["team"]["id"]
    h = team["headers"]
    doing = team["status_ids"]["In Progress"]
    _ok(client.patch(f"/statuses/{doing}", json={"wip_limit": 2}, headers=h))

    def ticket(title, **fields):
        return _ok(
            client.post(
                f"/teams/{team_id}/tickets", json={"title": title, **fields}, headers=h
            )
        )

    held = [ticket(f"Held {n}", status_id=doing) for n in (1, 2)]
    waiting = ticket("Waiting")
    return {
        **team,
        "team_id": team_id,
        "doing": doing,
        "held": held,
        "waiting": waiting,
        "ticket": ticket,
    }


def make_hard(client, board, **settings):
    _ok(
        client.patch(
            f"/teams/{board['team_id']}",
            json={"wip_limits_hard": True, **settings},
            headers=board["headers"],
        )
    )


def move(client, board, ticket, status_id):
    return client.patch(
        f"/tickets/{ticket['id']}",
        json={"status_id": status_id},
        headers=board["headers"],
    )


def full(response, holds=2, makes=3):
    assert response.status_code == 409, response.text
    assert response.json() == {
        "detail": f"In Progress is full. It holds {holds}, and this would make "
        f"{makes}. Finish or move one first.",
        "code": "wip_limit_reached",
    }


def test_a_team_admin_sets_a_limit_and_takes_it_away(client, team, auth):
    doing = team["status_ids"]["In Progress"]
    h = team["headers"]
    assert (
        _ok(client.patch(f"/statuses/{doing}", json={"wip_limit": 3}, headers=h))[
            "wip_limit"
        ]
        == 3
    )
    # Left out, it stays.
    assert (
        _ok(client.patch(f"/statuses/{doing}", json={"name": "Doing"}, headers=h))[
            "wip_limit"
        ]
        == 3
    )
    assert (
        _ok(client.patch(f"/statuses/{doing}", json={"wip_limit": None}, headers=h))[
            "wip_limit"
        ]
        is None
    )
    assert (
        client.patch(f"/statuses/{doing}", json={"wip_limit": 0}, headers=h).status_code
        == 422
    )

    member = auth(email="daniel@softtrack.dev", full_name="Daniel Okafor")
    _ok(
        client.post(
            f"/teams/{team['team']['id']}/members",
            json={"email": "daniel@softtrack.dev", "role": "member"},
            headers=h,
        )
    )
    refused = client.patch(
        f"/statuses/{doing}", json={"wip_limit": 3}, headers=member["headers"]
    )
    assert refused.status_code == 403


def test_by_default_a_column_goes_over_and_says_so(client, board):
    assert board["team"]["wip_limits_hard"] is False
    assert board["team"]["wip_counts_subtickets"] is True
    _ok(move(client, board, board["waiting"], board["doing"]))
    load = _ok(
        client.get(f"/teams/{board['team_id']}/estimates", headers=board["headers"])
    )["by_status"][str(board["doing"])]
    assert (load["ticket_count"], load["wip_count"]) == (3, 3)


def test_a_hard_limit_refuses_an_edit_with_a_sentence(client, board):
    make_hard(client, board)
    full(move(client, board, board["waiting"], board["doing"]))
    # Nothing changed.
    assert (
        _ok(client.get(f"/tickets/{board['waiting']['id']}", headers=board["headers"]))[
            "status"
        ]["name"]
        == "Backlog"
    )


def test_and_the_boards_move_and_a_new_ticket(client, board):
    make_hard(client, board)
    full(
        client.post(
            f"/tickets/{board['waiting']['id']}/move",
            json={"status_id": board["doing"]},
            headers=board["headers"],
        )
    )
    full(
        client.post(
            f"/teams/{board['team_id']}/tickets",
            json={"title": "Another", "status_id": board["doing"]},
            headers=board["headers"],
        )
    )


def test_and_a_bulk_edit_all_or_nothing(client, board):
    make_hard(client, board)
    _ok(move(client, board, board["held"][0], board["status_ids"]["Done"]))
    other = board["ticket"]("Other")
    response = client.post(
        f"/teams/{board['team_id']}/tickets/bulk-update",
        json={
            "ticket_ids": [board["waiting"]["id"], other["id"]],
            "changes": {"status_id": board["doing"]},
        },
        headers=board["headers"],
    )
    full(response, holds=2, makes=3)
    for ticket in (board["waiting"], other):
        assert (
            _ok(client.get(f"/tickets/{ticket['id']}", headers=board["headers"]))[
                "status"
            ]["name"]
            == "Backlog"
        )


def test_tickets_already_in_the_column_and_moves_out_are_never_held_back(client, board):
    make_hard(client, board)
    held = board["held"][0]
    _ok(
        client.patch(
            f"/tickets/{held['id']}",
            json={"title": "Still here", "status_id": board["doing"]},
            headers=board["headers"],
        )
    )
    _ok(move(client, board, held, board["status_ids"]["Done"]))
    # And now there is room again.
    _ok(move(client, board, board["waiting"], board["doing"]))


def test_where_sub_tickets_do_not_count_they_go_in_freely(client, board):
    make_hard(client, board, wip_counts_subtickets=False)
    child = board["ticket"]("Part of it", parent_id=board["waiting"]["id"])
    _ok(move(client, board, child, board["doing"]))
    load = _ok(
        client.get(f"/teams/{board['team_id']}/estimates", headers=board["headers"])
    )["by_status"][str(board["doing"])]
    assert (load["ticket_count"], load["wip_count"]) == (3, 2)
    # The work itself still counts.
    full(move(client, board, board["waiting"], board["doing"]))


def test_an_automation_rule_skips_the_move_and_says_so(client, board):
    make_hard(client, board)
    _ok(
        client.post(
            f"/teams/{board['team_id']}/automation-rules",
            json={
                "name": "Start what is assigned",
                "trigger": "ticket_assigned",
                "conditions": {},
                "actions": {"set_status_id": board["doing"]},
            },
            headers=board["headers"],
        )
    )
    # The assignment that set the rule off goes through.
    assigned = _ok(
        client.patch(
            f"/tickets/{board['waiting']['id']}",
            json={"assignee_id": board["user"]["id"]},
            headers=board["headers"],
        )
    )
    assert assigned["status"]["name"] == "Backlog"
    runs = _ok(
        client.get(
            f"/teams/{board['team_id']}/automation-runs", headers=board["headers"]
        )
    )["items"]
    assert runs[0]["summary"].startswith(
        "Did not move it to In Progress: In Progress is full."
    )


def test_a_ticket_moved_to_another_team_follows_its_limits(client, board, auth):
    other = auth(email="ops@softtrack.dev", full_name="Ops Lead")
    ops = _ok(
        client.post(
            "/teams", json={"name": "Ops", "key": "OPS"}, headers=other["headers"]
        )
    )
    ops_statuses = status_ids(client, other, ops["id"])
    _ok(
        client.post(
            f"/teams/{ops['id']}/members",
            json={"email": board["user"]["email"], "role": "member"},
            headers=other["headers"],
        )
    )
    oh = other["headers"]
    _ok(
        client.patch(
            f"/statuses/{ops_statuses['In Progress']}",
            json={"wip_limit": 1},
            headers=oh,
        )
    )
    _ok(client.patch(f"/teams/{ops['id']}", json={"wip_limits_hard": True}, headers=oh))
    _ok(
        client.post(
            f"/teams/{ops['id']}/tickets",
            json={"title": "Busy", "status_id": ops_statuses["In Progress"]},
            headers=oh,
        )
    )
    # In Progress on Engineering lands in In Progress on Ops, which is full.
    refused = client.post(
        f"/tickets/{board['held'][0]['id']}/transfer",
        json={"team_id": ops["id"]},
        headers=board["headers"],
    )
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "wip_limit_reached"
