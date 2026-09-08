"""Automation rules: what fires, what it does, and what it writes down (issue #24).

The properties most of these guard, in the order they would hurt if they broke:

* A rule's own changes never fire another rule. Two rules pointing at each
  other would otherwise spin until the request died.
* Nothing an automation does is attributed to a person. The actor on the
  history rows and the comments is null, not whoever tripped the rule.
* Every automated change is in the run log, and the log outlives the rule --
  which is what makes a surprising change traceable after somebody has deleted
  the rule that surprised them.
"""

import pytest

from lib_softtrack.tables import IssueEvent


@pytest.fixture
def pair(client, team, auth):
    """A team admin and a plain member. Writing rules is an admin's job."""
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    response = client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return {**team, "member": member}


def create_rule(
    client,
    actor,
    team_id,
    name="A rule",
    trigger="issue_created",
    conditions=None,
    expect=200,
    **actions,
):
    response = client.post(
        f"/teams/{team_id}/automation-rules",
        json={
            "name": name,
            "trigger": trigger,
            "conditions": conditions or {},
            "actions": actions,
        },
        headers=actor["headers"],
    )
    assert response.status_code == expect, response.text
    return response.json()


def create_issue(client, actor, team_id, **fields):
    response = client.post(
        f"/teams/{team_id}/issues",
        json={"title": "An issue", **fields},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def get_issue(client, actor, issue_id):
    response = client.get(f"/issues/{issue_id}", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def runs(client, actor, team_id, **params):
    response = client.get(
        f"/teams/{team_id}/automation-runs", params=params, headers=actor["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def comments(client, actor, issue_id):
    response = client.get(f"/issues/{issue_id}/comments", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()["items"]


# --- writing a rule down ---------------------------------------------------


def test_a_rule_round_trips_its_conditions_and_actions(client, pair):
    rule = create_rule(
        client,
        pair,
        pair["team"]["id"],
        name="Triage urgent bugs",
        trigger="issue_created",
        conditions={"if_priority": "urgent"},
        set_status_id=pair["status_ids"]["Todo"],
        set_assignee_id=pair["user"]["id"],
    )
    assert rule["trigger"] == "issue_created"
    assert rule["conditions"]["if_priority"] == "urgent"
    assert rule["actions"]["set_status_id"] == pair["status_ids"]["Todo"]
    assert rule["is_enabled"] is True
    # Everything unstated stays unstated rather than becoming a condition that
    # matches nothing.
    assert rule["conditions"]["if_label_id"] is None
    assert rule["conditions"]["if_unassigned"] is False


def test_a_rule_that_does_nothing_is_refused(client, pair):
    """It would sit in the list looking enabled and never do anything."""
    response = client.post(
        f"/teams/{pair['team']['id']}/automation-rules",
        json={"name": "Inert", "trigger": "issue_created", "actions": {}},
        headers=pair["headers"],
    )
    assert response.status_code == 422


def test_matching_an_assignee_and_unassigned_is_refused(client, pair):
    response = client.post(
        f"/teams/{pair['team']['id']}/automation-rules",
        json={
            "name": "Impossible",
            "trigger": "issue_created",
            "conditions": {
                "if_assignee_id": pair["user"]["id"],
                "if_unassigned": True,
            },
            "actions": {"set_priority": "high"},
        },
        headers=pair["headers"],
    )
    assert response.status_code == 422


def test_a_named_cycle_and_the_active_one_is_refused(client, pair):
    response = client.post(
        f"/teams/{pair['team']['id']}/automation-rules",
        json={
            "name": "Both",
            "trigger": "issue_created",
            "actions": {"set_cycle_id": 1, "move_to_active_cycle": True},
        },
        headers=pair["headers"],
    )
    assert response.status_code == 422


def test_a_rule_cannot_name_another_teams_status(client, pair, auth):
    """It would take work off this team's board, or match nothing forever."""
    other = auth(email="other@softtrack.dev", full_name="Other Person")
    response = client.post(
        "/teams", json={"name": "Design", "key": "DES"}, headers=other["headers"]
    )
    other_team = response.json()
    foreign = client.get(
        f"/teams/{other_team['id']}/statuses", headers=other["headers"]
    ).json()[0]["id"]

    create_rule(
        client,
        pair,
        pair["team"]["id"],
        set_status_id=foreign,
        expect=400,
    )


def test_only_admins_write_rules_but_anyone_reads_them(client, pair):
    create_rule(
        client,
        pair["member"],
        pair["team"]["id"],
        set_priority="high",
        expect=403,
    )
    create_rule(client, pair, pair["team"]["id"], set_priority="high")

    # A rule acts on your issues; being unable to find out what the rules are
    # is not a reasonable place to be.
    response = client.get(
        f"/teams/{pair['team']['id']}/automation-rules",
        headers=pair["member"]["headers"],
    )
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_two_rules_on_a_team_cannot_share_a_name(client, pair):
    create_rule(client, pair, pair["team"]["id"], name="Triage", set_priority="high")
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        name="Triage",
        set_priority="low",
        expect=400,
    )


def test_a_rule_can_be_rewritten_in_place(client, pair):
    """Renaming, re-triggering and re-writing a rule are separate gestures and
    each sends only what it changed -- but the log stays attached either way."""
    rule = create_rule(
        client, pair, pair["team"]["id"], name="Draft", set_priority="low"
    )
    response = client.patch(
        f"/automation-rules/{rule['id']}",
        json={
            "name": "Escalate stale reviews",
            "trigger": "status_changed",
            "conditions": {"if_status_id": pair["status_ids"]["In Review"]},
            "actions": {"set_priority": "urgent"},
        },
        headers=pair["headers"],
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["name"] == "Escalate stale reviews"
    assert updated["trigger"] == "status_changed"
    assert updated["conditions"]["if_status_id"] == pair["status_ids"]["In Review"]
    # Rewriting the actions replaces them rather than merging: the old
    # `set_priority: low` is gone, not overlaid.
    assert updated["actions"]["set_priority"] == "urgent"


def test_rewriting_a_rule_is_checked_against_its_team(client, pair, auth):
    rule = create_rule(client, pair, pair["team"]["id"], set_priority="low")
    stranger = auth(email="stranger@softtrack.dev", full_name="A Stranger")

    response = client.patch(
        f"/automation-rules/{rule['id']}",
        json={"actions": {"set_assignee_id": stranger["user"]["id"]}},
        headers=pair["headers"],
    )
    assert response.status_code == 400
    assert "not on this team" in response.json()["detail"]


def test_a_rule_on_a_team_you_are_not_in_is_not_found(client, pair, auth):
    rule = create_rule(client, pair, pair["team"]["id"], set_priority="low")
    outsider = auth(email="outsider@softtrack.dev", full_name="An Outsider")

    response = client.patch(
        f"/automation-rules/{rule['id']}",
        json={"is_enabled": False},
        headers=outsider["headers"],
    )
    assert response.status_code == 403

    response = client.delete("/automation-rules/9999", headers=pair["headers"])
    assert response.status_code == 404


def test_the_log_can_be_narrowed_to_one_rule(client, pair):
    quiet = create_rule(
        client, pair, pair["team"]["id"], name="Quiet", set_priority="low"
    )
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        name="Loud",
        trigger="comment_added",
        set_priority="urgent",
    )
    issue = create_issue(client, pair, pair["team"]["id"])
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "ping"},
        headers=pair["headers"],
    )

    assert runs(client, pair, pair["team"]["id"])["total"] == 2
    narrowed = runs(client, pair, pair["team"]["id"], rule_id=quiet["id"])
    assert narrowed["total"] == 1
    assert narrowed["items"][0]["rule_name"] == "Quiet"


# --- triggers --------------------------------------------------------------


def test_issue_created_fires_on_a_new_issue(client, pair):
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        trigger="issue_created",
        set_priority="urgent",
    )
    issue = create_issue(client, pair, pair["team"]["id"])
    assert issue["priority"] == "urgent" or (
        get_issue(client, pair, issue["id"])["priority"] == "urgent"
    )


def test_status_changed_fires_only_when_the_status_moved(client, pair):
    todo = pair["status_ids"]["Todo"]
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        trigger="status_changed",
        conditions={"if_status_id": pair["status_ids"]["Done"]},
        set_priority="low",
    )
    issue = create_issue(client, pair, pair["team"]["id"], status_id=todo)

    # A PATCH setting the status to what it already was is not a change.
    client.patch(
        f"/issues/{issue['id']}",
        json={"status_id": todo},
        headers=pair["headers"],
    )
    assert runs(client, pair, pair["team"]["id"])["total"] == 0

    client.patch(
        f"/issues/{issue['id']}",
        json={"status_id": pair["status_ids"]["Done"]},
        headers=pair["headers"],
    )
    assert get_issue(client, pair, issue["id"])["priority"] == "low"


def test_issue_assigned_does_not_fire_on_being_unassigned(client, pair):
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        trigger="issue_assigned",
        set_priority="high",
    )
    issue = create_issue(
        client, pair, pair["team"]["id"], assignee_id=pair["user"]["id"]
    )
    assert get_issue(client, pair, issue["id"])["priority"] == "high"

    before = runs(client, pair, pair["team"]["id"])["total"]
    client.patch(
        f"/issues/{issue['id']}", json={"assignee_id": None}, headers=pair["headers"]
    )
    assert runs(client, pair, pair["team"]["id"])["total"] == before


def test_comment_added_fires_on_a_comment(client, pair):
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        trigger="comment_added",
        set_status_id=pair["status_ids"]["In Progress"],
    )
    issue = create_issue(client, pair, pair["team"]["id"])
    response = client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "Looking at this"},
        headers=pair["headers"],
    )
    assert response.status_code == 200, response.text
    assert (
        get_issue(client, pair, issue["id"])["status"]["id"]
        == pair["status_ids"]["In Progress"]
    )


def test_cycle_completed_fires_on_everything_that_was_in_the_cycle(client, pair):
    """Including the unfinished work, which has already carried over by then."""
    response = client.post(
        f"/teams/{pair['team']['id']}/cycles",
        json={
            "name": "Sprint 1",
            "starts_at": "2026-01-01T00:00:00Z",
            "ends_at": "2026-01-14T00:00:00Z",
        },
        headers=pair["headers"],
    )
    cycle = response.json()
    client.post(f"/cycles/{cycle['id']}/start", headers=pair["headers"])

    finished = create_issue(
        client,
        pair,
        pair["team"]["id"],
        cycle_id=cycle["id"],
        status_id=pair["status_ids"]["Done"],
    )
    unfinished = create_issue(client, pair, pair["team"]["id"], cycle_id=cycle["id"])

    create_rule(
        client,
        pair,
        pair["team"]["id"],
        trigger="cycle_completed",
        set_priority="medium",
    )
    client.post(f"/cycles/{cycle['id']}/complete", headers=pair["headers"])

    assert get_issue(client, pair, finished["id"])["priority"] == "medium"
    assert get_issue(client, pair, unfinished["id"])["priority"] == "medium"


# --- conditions ------------------------------------------------------------


def test_a_rule_with_no_conditions_matches_everything(client, pair):
    create_rule(client, pair, pair["team"]["id"], set_priority="low")
    issue = create_issue(client, pair, pair["team"]["id"])
    assert get_issue(client, pair, issue["id"])["priority"] == "low"


def test_conditions_are_anded(client, pair):
    label = client.post(
        f"/teams/{pair['team']['id']}/labels",
        json={"name": "bug"},
        headers=pair["headers"],
    ).json()
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        conditions={"if_priority": "urgent", "if_label_id": label["id"]},
        set_status_id=pair["status_ids"]["Todo"],
    )

    # Priority but no label: no match.
    only_priority = create_issue(client, pair, pair["team"]["id"], priority="urgent")
    assert (
        get_issue(client, pair, only_priority["id"])["status"]["id"]
        != pair["status_ids"]["Todo"]
    )

    both = create_issue(
        client, pair, pair["team"]["id"], priority="urgent", label_ids=[label["id"]]
    )
    assert (
        get_issue(client, pair, both["id"])["status"]["id"]
        == pair["status_ids"]["Todo"]
    )


def test_unassigned_is_not_the_same_as_any_assignee(client, pair):
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        conditions={"if_unassigned": True},
        set_priority="urgent",
    )
    assigned = create_issue(
        client, pair, pair["team"]["id"], assignee_id=pair["user"]["id"]
    )
    nobody = create_issue(client, pair, pair["team"]["id"])

    assert get_issue(client, pair, assigned["id"])["priority"] == "no_priority"
    assert get_issue(client, pair, nobody["id"])["priority"] == "urgent"


def test_a_disabled_rule_does_nothing(client, pair):
    rule = create_rule(client, pair, pair["team"]["id"], set_priority="urgent")
    client.patch(
        f"/automation-rules/{rule['id']}",
        json={"is_enabled": False},
        headers=pair["headers"],
    )
    issue = create_issue(client, pair, pair["team"]["id"])
    assert get_issue(client, pair, issue["id"])["priority"] == "no_priority"
    assert runs(client, pair, pair["team"]["id"])["total"] == 0


# --- actions ---------------------------------------------------------------


def test_a_label_action_adds_rather_than_replaces(client, pair):
    keep = client.post(
        f"/teams/{pair['team']['id']}/labels",
        json={"name": "keep"},
        headers=pair["headers"],
    ).json()
    added = client.post(
        f"/teams/{pair['team']['id']}/labels",
        json={"name": "triaged"},
        headers=pair["headers"],
    ).json()

    create_rule(client, pair, pair["team"]["id"], add_label_id=added["id"])
    issue = create_issue(client, pair, pair["team"]["id"], label_ids=[keep["id"]])

    names = {label["name"] for label in get_issue(client, pair, issue["id"])["labels"]}
    assert names == {"keep", "triaged"}


def test_a_comment_action_posts_with_no_author(client, pair):
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        comment_body="Filed outside a cycle -- please size it.",
    )
    issue = create_issue(client, pair, pair["team"]["id"])

    posted = comments(client, pair, issue["id"])
    assert len(posted) == 1
    assert posted[0]["body"].startswith("Filed outside a cycle")
    # Not attributed to whoever filed the issue. Nobody wrote it.
    assert posted[0]["author"] is None


def test_the_active_cycle_is_resolved_when_the_rule_fires(client, pair):
    """A named cycle would stop meaning "the sprint" a fortnight later."""
    cycle = client.post(
        f"/teams/{pair['team']['id']}/cycles",
        json={
            "name": "Sprint 1",
            "starts_at": "2026-01-01T00:00:00Z",
            "ends_at": "2026-01-14T00:00:00Z",
        },
        headers=pair["headers"],
    ).json()

    create_rule(
        client,
        pair,
        pair["team"]["id"],
        conditions={"if_priority": "urgent"},
        move_to_active_cycle=True,
    )

    # Nothing running yet: the rule matches and quietly has nowhere to move it.
    before = create_issue(client, pair, pair["team"]["id"], priority="urgent")
    assert get_issue(client, pair, before["id"])["cycle_id"] is None

    client.post(f"/cycles/{cycle['id']}/start", headers=pair["headers"])
    after = create_issue(client, pair, pair["team"]["id"], priority="urgent")
    assert get_issue(client, pair, after["id"])["cycle_id"] == cycle["id"]


def test_rules_run_in_the_order_they_were_written(client, pair):
    create_rule(client, pair, pair["team"]["id"], name="First", set_priority="low")
    create_rule(client, pair, pair["team"]["id"], name="Second", set_priority="urgent")
    issue = create_issue(client, pair, pair["team"]["id"])
    assert get_issue(client, pair, issue["id"])["priority"] == "urgent"


def test_a_project_condition_narrows_to_that_project(client, pair):
    platform = client.post(
        f"/teams/{pair['team']['id']}/projects",
        json={"name": "Platform"},
        headers=pair["headers"],
    ).json()
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        conditions={"if_project_id": platform["id"]},
        set_priority="urgent",
    )

    elsewhere = create_issue(client, pair, pair["team"]["id"])
    inside = create_issue(client, pair, pair["team"]["id"], project_id=platform["id"])
    assert get_issue(client, pair, elsewhere["id"])["priority"] == "no_priority"
    assert get_issue(client, pair, inside["id"])["priority"] == "urgent"


def test_an_assignee_condition_narrows_to_that_person(client, pair):
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        conditions={"if_assignee_id": pair["member"]["user"]["id"]},
        set_priority="urgent",
    )
    mine = create_issue(
        client, pair, pair["team"]["id"], assignee_id=pair["user"]["id"]
    )
    theirs = create_issue(
        client, pair, pair["team"]["id"], assignee_id=pair["member"]["user"]["id"]
    )
    assert get_issue(client, pair, mine["id"])["priority"] == "no_priority"
    assert get_issue(client, pair, theirs["id"])["priority"] == "urgent"


def test_a_named_cycle_action_moves_the_issue_into_it(client, pair):
    """The other half of the cycle action -- `move_to_active_cycle` is above."""
    cycle = client.post(
        f"/teams/{pair['team']['id']}/cycles",
        json={
            "name": "Sprint 1",
            "starts_at": "2026-01-01T00:00:00Z",
            "ends_at": "2026-01-14T00:00:00Z",
        },
        headers=pair["headers"],
    ).json()
    create_rule(client, pair, pair["team"]["id"], set_cycle_id=cycle["id"])

    issue = create_issue(client, pair, pair["team"]["id"])
    assert get_issue(client, pair, issue["id"])["cycle_id"] == cycle["id"]
    assert (
        "Moved to Sprint 1"
        in runs(client, pair, pair["team"]["id"])["items"][0]["summary"]
    )


def test_the_log_is_capped_so_it_cannot_grow_without_bound(client, pair, monkeypatch):
    """It is written on every automated change and read roughly never, so it is
    the one table here that grows without anybody deciding to grow it."""
    monkeypatch.setattr("lib_softtrack.rules.MAX_RUNS_PER_TEAM", 3)
    create_rule(client, pair, pair["team"]["id"], set_priority="urgent")

    for _ in range(5):
        create_issue(client, pair, pair["team"]["id"])

    log = runs(client, pair, pair["team"]["id"])
    assert log["total"] == 3
    # The three kept are the most recent, not the first three.
    identifiers = [entry["issue_identifier"] for entry in log["items"]]
    assert identifiers == ["ENG-5", "ENG-4", "ENG-3"]


# --- the property that keeps it from looping -------------------------------


def test_a_rules_own_change_does_not_fire_another_rule(client, pair):
    """The whole safety story: one event is one pass over the rules.

    Without it these two rules push the issue back and forth until the request
    dies, and a team finds out by watching an issue's history fill up.
    """
    todo = pair["status_ids"]["Todo"]
    done = pair["status_ids"]["Done"]
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        name="To done",
        trigger="status_changed",
        conditions={"if_status_id": todo},
        set_status_id=done,
    )
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        name="Back to todo",
        trigger="status_changed",
        conditions={"if_status_id": done},
        set_status_id=todo,
    )

    issue = create_issue(
        client, pair, pair["team"]["id"], status_id=pair["status_ids"]["Backlog"]
    )
    response = client.patch(
        f"/issues/{issue['id']}", json={"status_id": todo}, headers=pair["headers"]
    )
    assert response.status_code == 200

    # One pass: "To done" moved it, and "Back to todo" was not reconsidered.
    assert get_issue(client, pair, issue["id"])["status"]["id"] == done
    assert runs(client, pair, pair["team"]["id"])["total"] == 1


def test_one_trigger_does_not_set_off_another(client, pair):
    """The same guarantee across triggers, not only within one.

    An `issue_created` rule that assigns the issue must not go on to fire the
    `issue_assigned` rules -- that is the one door a "rules never fire rules"
    engine would otherwise leave open, and it is not obvious from either hook
    on its own.
    """
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        name="Auto-assign",
        trigger="issue_created",
        set_assignee_id=pair["member"]["user"]["id"],
    )
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        name="On assignment",
        trigger="issue_assigned",
        set_priority="urgent",
    )

    issue = create_issue(client, pair, pair["team"]["id"])
    assert (
        get_issue(client, pair, issue["id"])["assignee"]["id"]
        == pair["member"]["user"]["id"]
    )
    # Assigned by a rule, so the assignment rules were not reconsidered.
    assert get_issue(client, pair, issue["id"])["priority"] == "no_priority"

    log = runs(client, pair, pair["team"]["id"])
    assert [entry["rule_name"] for entry in log["items"]] == ["Auto-assign"]


def test_a_status_rule_that_assigns_does_not_fire_the_assignment_rules(client, pair):
    """The same door, reached through an update rather than a creation."""
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        name="Hand it over",
        trigger="status_changed",
        set_assignee_id=pair["member"]["user"]["id"],
    )
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        name="On assignment",
        trigger="issue_assigned",
        set_priority="urgent",
    )

    issue = create_issue(client, pair, pair["team"]["id"])
    client.patch(
        f"/issues/{issue['id']}",
        json={"status_id": pair["status_ids"]["Done"]},
        headers=pair["headers"],
    )

    assert get_issue(client, pair, issue["id"])["priority"] == "no_priority"


def test_filing_an_issue_already_assigned_fires_both(client, pair):
    """The other side of it: two things really did happen, and a team with a
    rule about each means both."""
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        name="On creation",
        trigger="issue_created",
        set_status_id=pair["status_ids"]["Todo"],
    )
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        name="On assignment",
        trigger="issue_assigned",
        set_priority="urgent",
    )

    issue = create_issue(
        client, pair, pair["team"]["id"], assignee_id=pair["member"]["user"]["id"]
    )
    read = get_issue(client, pair, issue["id"])
    assert read["status"]["id"] == pair["status_ids"]["Todo"]
    assert read["priority"] == "urgent"


def test_an_automated_comment_does_not_fire_the_comment_trigger(client, pair):
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        trigger="comment_added",
        comment_body="Thanks!",
    )
    issue = create_issue(client, pair, pair["team"]["id"])
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "Any update?"},
        headers=pair["headers"],
    )
    # The person's comment, and exactly one from the rule.
    assert len(comments(client, pair, issue["id"])) == 2


# --- the run log -----------------------------------------------------------


def test_the_log_says_what_changed_and_who_set_it_off(client, pair):
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        name="Triage",
        set_priority="urgent",
        set_status_id=pair["status_ids"]["Todo"],
    )
    issue = create_issue(client, pair, pair["team"]["id"])

    log = runs(client, pair, pair["team"]["id"])
    assert log["total"] == 1
    entry = log["items"][0]
    assert entry["rule_name"] == "Triage"
    assert entry["trigger"] == "issue_created"
    assert entry["issue_identifier"] == issue["identifier"]
    assert entry["actor"]["id"] == pair["user"]["id"]
    assert "Set priority to urgent" in entry["summary"]
    assert "Set status to Todo" in entry["summary"]


def test_a_rule_that_had_nothing_left_to_do_writes_no_row(client, pair):
    """A log row saying "set the priority to the one it already had" is the
    log lying on the one occasion somebody reads it closely."""
    create_rule(client, pair, pair["team"]["id"], set_priority="urgent")
    create_issue(client, pair, pair["team"]["id"], priority="urgent")
    assert runs(client, pair, pair["team"]["id"])["total"] == 0


def test_the_log_outlives_the_rule(client, pair):
    """Deleting a rule for having surprised somebody is exactly when the log
    of what it did is wanted."""
    rule = create_rule(
        client, pair, pair["team"]["id"], name="Surprising", set_priority="urgent"
    )
    create_issue(client, pair, pair["team"]["id"])

    response = client.delete(f"/automation-rules/{rule['id']}", headers=pair["headers"])
    assert response.status_code == 204

    log = runs(client, pair, pair["team"]["id"])
    assert log["total"] == 1
    assert log["items"][0]["rule_id"] is None
    assert log["items"][0]["rule_name"] == "Surprising"


def test_the_log_can_be_narrowed_to_one_issue(client, pair):
    create_rule(client, pair, pair["team"]["id"], set_priority="urgent")
    first = create_issue(client, pair, pair["team"]["id"])
    create_issue(client, pair, pair["team"]["id"])

    assert runs(client, pair, pair["team"]["id"])["total"] == 2
    assert runs(client, pair, pair["team"]["id"], issue_id=first["id"])["total"] == 1


def test_deleting_an_issue_takes_its_log_rows_with_it(client, pair):
    """They hold a foreign key to it, and a row about an issue that no longer
    exists is a link to a 404."""
    create_rule(client, pair, pair["team"]["id"], set_priority="urgent")
    issue = create_issue(client, pair, pair["team"]["id"])
    assert runs(client, pair, pair["team"]["id"])["total"] == 1

    response = client.delete(f"/issues/{issue['id']}", headers=pair["headers"])
    assert response.status_code == 204
    assert runs(client, pair, pair["team"]["id"])["total"] == 0


def test_a_member_can_read_the_log(client, pair):
    """It answers "why did my issue move", and the person asking is the one it
    moved out from under."""
    create_rule(client, pair, pair["team"]["id"], set_priority="urgent")
    create_issue(client, pair, pair["team"]["id"])
    assert runs(client, pair["member"], pair["team"]["id"])["total"] == 1


# --- not attributing anything to a person ----------------------------------


def test_an_automated_change_is_recorded_with_no_actor(client, pair, session):
    """Somebody dragging a card should not find their name on the four other
    changes a rule made afterwards.

    Read from the table rather than an endpoint: history is charted, not
    listed, so there is nothing to GET. Same approach as test_history.py.
    """
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        trigger="issue_created",
        set_status_id=pair["status_ids"]["Done"],
    )
    issue = create_issue(
        client, pair, pair["team"]["id"], status_id=pair["status_ids"]["Backlog"]
    )

    events = sorted(
        session.query(IssueEvent).filter(IssueEvent.issue_id == issue["id"]).all(),
        key=lambda row: row.id,
    )
    opening = [row for row in events if row.new_value == "backlog"]
    moved = [row for row in events if row.new_value == "done"]
    # The creation event is the person's; the move to Done is nobody's.
    assert opening and opening[0].actor_id == pair["user"]["id"]
    assert moved and all(row.actor_id is None for row in moved)


def test_an_automated_assignment_still_tells_the_assignee(client, pair):
    """Nobody did it, so nobody is excluded from being told about it."""
    create_rule(
        client,
        pair,
        pair["team"]["id"],
        trigger="comment_added",
        set_assignee_id=pair["member"]["user"]["id"],
    )
    issue = create_issue(client, pair, pair["team"]["id"])
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "Over to you"},
        headers=pair["headers"],
    )

    inbox = client.get("/notifications", headers=pair["member"]["headers"]).json()[
        "items"
    ]
    assigned = [row for row in inbox if row["kind"] == "assigned"]
    assert len(assigned) == 1
    assert assigned[0]["actor"] is None


# --- keeping rules honest when what they name goes away --------------------


def test_deleting_a_status_sends_the_rules_after_the_issues(client, pair):
    """Clearing the condition instead would widen the rule to every issue on
    the team, which is the opposite of what the team asked for."""
    qa = client.post(
        f"/teams/{pair['team']['id']}/statuses",
        json={"name": "QA", "category": "started"},
        headers=pair["headers"],
    ).json()
    rule = create_rule(
        client,
        pair,
        pair["team"]["id"],
        trigger="status_changed",
        conditions={"if_status_id": qa["id"]},
        set_status_id=qa["id"],
    )

    response = client.request(
        "DELETE",
        f"/statuses/{qa['id']}",
        json={"move_to_id": pair["status_ids"]["In Progress"]},
        headers=pair["headers"],
    )
    assert response.status_code == 200, response.text

    updated = client.get(
        f"/teams/{pair['team']['id']}/automation-rules", headers=pair["headers"]
    ).json()[0]
    assert updated["id"] == rule["id"]
    assert updated["conditions"]["if_status_id"] == pair["status_ids"]["In Progress"]
    assert updated["actions"]["set_status_id"] == pair["status_ids"]["In Progress"]


def test_deleting_a_cycle_switches_off_the_rules_that_filled_it(client, pair):
    """There is nowhere to send them, and a rule left enabled would silently
    do less than it says."""
    cycle = client.post(
        f"/teams/{pair['team']['id']}/cycles",
        json={
            "name": "Sprint 1",
            "starts_at": "2026-01-01T00:00:00Z",
            "ends_at": "2026-01-14T00:00:00Z",
        },
        headers=pair["headers"],
    ).json()
    create_rule(client, pair, pair["team"]["id"], set_cycle_id=cycle["id"])

    response = client.delete(f"/cycles/{cycle['id']}", headers=pair["headers"])
    assert response.status_code == 204, response.text

    rule = client.get(
        f"/teams/{pair['team']['id']}/automation-rules", headers=pair["headers"]
    ).json()[0]
    assert rule["is_enabled"] is False
    assert rule["actions"]["set_cycle_id"] is None


def test_a_rule_cannot_be_pointed_at_a_completed_cycle(client, pair):
    """Its numbers are history everywhere else in SoftTrack, and a rule that
    kept dropping work into it would rewrite a report on every run."""
    cycle = client.post(
        f"/teams/{pair['team']['id']}/cycles",
        json={
            "name": "Sprint 1",
            "starts_at": "2026-01-01T00:00:00Z",
            "ends_at": "2026-01-14T00:00:00Z",
        },
        headers=pair["headers"],
    ).json()
    client.post(f"/cycles/{cycle['id']}/start", headers=pair["headers"])
    client.post(f"/cycles/{cycle['id']}/complete", headers=pair["headers"])

    create_rule(client, pair, pair["team"]["id"], set_cycle_id=cycle["id"], expect=400)
