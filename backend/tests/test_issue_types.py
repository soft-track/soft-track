"""Issue types: bug, task, story (issue #89).

A fixed three with task as the default, a filter, a condition and an action
in automation rules, and the Jira importer mapping onto them.
"""

import json

from lib_softtrack.jira import parse_csv, parse_json


def make_issue(client, team, title="Work", **fields):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": title, **fields},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def listed(client, team, **params):
    response = client.get(
        f"/teams/{team['team']['id']}/issues", params=params, headers=team["headers"]
    )
    assert response.status_code == 200, response.text
    return sorted(issue["title"] for issue in response.json()["items"])


def make_rule(client, team, trigger, conditions, actions):
    response = client.post(
        f"/teams/{team['team']['id']}/automation-rules",
        json={
            "name": f"Rule {trigger}",
            "trigger": trigger,
            "conditions": conditions,
            "actions": actions,
        },
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_an_issue_is_a_task_unless_it_says_otherwise(client, team):
    assert make_issue(client, team)["type"] == "task"


def test_the_type_is_set_on_create_and_changed_later(client, team):
    issue = make_issue(client, team, type="bug")
    assert issue["type"] == "bug"
    response = client.patch(
        f"/issues/{issue['id']}", json={"type": "story"}, headers=team["headers"]
    )
    assert response.json()["type"] == "story"


def test_there_is_no_epic_type(client, team):
    """Epics are projects (#60-#64); a type would be a second hierarchy."""
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": "Big thing", "type": "epic"},
        headers=team["headers"],
    )
    assert response.status_code == 422


def test_the_list_can_be_narrowed_to_one_type(client, team):
    make_issue(client, team, "A bug", type="bug")
    make_issue(client, team, "A story", type="story")
    make_issue(client, team, "A task")
    assert listed(client, team, type="bug") == ["A bug"]
    assert listed(client, team, type="task") == ["A task"]


def test_a_saved_view_keeps_the_type_filter(client, team):
    response = client.post(
        f"/teams/{team['team']['id']}/views",
        json={"name": "Bugs", "filters": {"type": "bug"}},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    assert response.json()["filters"]["type"] == "bug"


def test_a_rule_can_be_conditioned_on_the_type(client, team):
    make_rule(
        client,
        team,
        "issue_created",
        {"if_type": "bug"},
        {"set_priority": "high"},
    )
    assert make_issue(client, team, "A bug", type="bug")["priority"] == "high"
    assert make_issue(client, team, "A task")["priority"] == "no_priority"


def test_a_rule_can_set_the_type(client, team):
    make_rule(
        client, team, "issue_created", {"if_priority": "urgent"}, {"set_type": "bug"}
    )
    issue = make_issue(client, team, "On fire", priority="urgent")
    read = client.get(f"/issues/{issue['id']}", headers=team["headers"]).json()
    assert read["type"] == "bug"


# --- the Jira importer ----------------------------------------------------------


def test_jira_csv_types_map_onto_ours():
    csv = (
        "Summary,Issue key,Issue Type,Status,Priority\n"
        "Crash on save,J-1,Bug,To Do,High\n"
        "Onboarding flow,J-2,Story,To Do,High\n"
        "Clean up CI,J-3,Task,To Do,High\n"
        "Faster search,J-4,Improvement,To Do,High\n"
        "Q3 platform,J-5,Epic,To Do,High\n"
    )
    assert [issue.type.value for issue in parse_csv(csv)] == [
        "bug",
        "story",
        "task",
        "task",
        "task",
    ]


def test_jira_json_types_map_onto_ours():
    export = json.dumps(
        {
            "issues": [
                {
                    "key": "J-1",
                    "fields": {"summary": "A", "issuetype": {"name": "Bug"}},
                },
                {
                    "key": "J-2",
                    "fields": {"summary": "B", "issuetype": {"name": "Story"}},
                },
                {
                    "key": "J-3",
                    "fields": {"summary": "C", "issuetype": {"name": "Sub-task"}},
                },
                {"key": "J-4", "fields": {"summary": "D"}},
            ]
        }
    )
    assert [issue.type.value for issue in parse_json(export)] == [
        "bug",
        "story",
        "task",
        "task",
    ]
