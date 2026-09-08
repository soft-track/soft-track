"""Importing a Jira export into a team (issue #11)."""

import io
import json

CSV = (
    "Issue key,Summary,Description,Status,Priority,Assignee,Reporter,Labels,Labels,"
    "Custom field (Epic Link),Comment\n"
    "PROJ-1,Fix login,It breaks,In Progress,High,demo@softtrack.dev,"
    "demo@softtrack.dev,backend,urgent,Checkout revamp,"
    '"12/Mar/24 9:00 AM;demo@softtrack.dev;Looking at it"\n'
    "PROJ-2,Add logout,,To Do,Low,,,frontend,,Checkout revamp,\n"
)


def upload(client, team, body=CSV, name="jira.csv", dry_run=True):
    response = client.post(
        f"/teams/{team['team']['id']}/import/jira",
        files={"file": (name, io.BytesIO(body.encode()), "text/csv")},
        data={"dry_run": str(dry_run).lower()},
        headers=team["headers"],
    )
    return response


def issues(client, team):
    return client.get(
        f"/teams/{team['team']['id']}/issues", headers=team["headers"]
    ).json()["items"]


# --- the dry run --------------------------------------------------------


def test_a_dry_run_writes_nothing(client, team):
    report = upload(client, team).json()
    assert report["dry_run"] is True
    assert report["issues_created"] == 2
    assert issues(client, team) == []


def test_a_dry_run_and_a_real_run_report_the_same_thing(client, team):
    """The preview has to be of the thing that then happens, or approving it
    means nothing."""
    preview = upload(client, team).json()
    real = upload(client, team, dry_run=False).json()

    for field in (
        "issues_found",
        "issues_created",
        "comments_created",
        "labels_created",
        "projects_created",
        "unmapped_statuses",
    ):
        assert preview[field] == real[field], field


def test_a_real_run_creates_the_issues(client, team):
    upload(client, team, dry_run=False)
    titles = sorted(issue["title"] for issue in issues(client, team))
    assert titles == ["Add logout", "Fix login"]


# --- what gets mapped ---------------------------------------------------


def test_status_priority_and_assignee_are_carried_over(client, team):
    upload(client, team, dry_run=False)
    issue = next(i for i in issues(client, team) if i["title"] == "Fix login")

    # The importer prefers a column the team already calls the same
    # thing, so "In Progress" lands in "In Progress" rather than merging
    # into whatever else is `started`.
    assert issue["status"]["name"] == "In Progress"
    assert issue["priority"] == "high"
    assert issue["assignee"]["email"] == "demo@softtrack.dev"


def test_the_jira_key_is_preserved(client, team):
    """So links in old documents and commit messages stay traceable."""
    upload(client, team, dry_run=False)
    keys = sorted(issue["external_key"] for issue in issues(client, team))
    assert keys == ["PROJ-1", "PROJ-2"]


def test_labels_are_created_and_attached(client, team):
    report = upload(client, team, dry_run=False).json()
    assert sorted(report["labels_created"]) == ["backend", "frontend", "urgent"]

    issue = next(i for i in issues(client, team) if i["title"] == "Fix login")
    assert sorted(label["name"] for label in issue["labels"]) == ["backend", "urgent"]


def test_an_epic_becomes_a_project_shared_by_its_issues(client, team):
    report = upload(client, team, dry_run=False).json()
    assert report["projects_created"] == ["Checkout revamp"]

    project_ids = {issue["project_id"] for issue in issues(client, team)}
    assert len(project_ids) == 1 and None not in project_ids


def test_comments_are_imported(client, team):
    upload(client, team, dry_run=False)
    issue = next(i for i in issues(client, team) if i["title"] == "Fix login")
    comments = client.get(
        f"/issues/{issue['id']}/comments", headers=team["headers"]
    ).json()
    assert [c["body"] for c in comments["items"]] == ["Looking at it"]


def test_an_existing_label_is_reused_rather_than_duplicated(client, team):
    client.post(
        f"/teams/{team['team']['id']}/labels",
        json={"name": "backend", "color": "#000000"},
        headers=team["headers"],
    )
    report = upload(client, team, dry_run=False).json()
    assert "backend" not in report["labels_created"]

    labels = client.get(
        f"/teams/{team['team']['id']}/labels", headers=team["headers"]
    ).json()
    assert sum(1 for label in labels if label["name"] == "backend") == 1


# --- people -------------------------------------------------------------


def test_a_matched_user_is_reported_with_how_they_matched(client, team):
    report = upload(client, team).json()
    match = next(m for m in report["users"] if m["source"] == "demo@softtrack.dev")
    assert match["matched_by"] == "email"
    assert match["matched_user_id"] is not None


def test_an_unmatched_person_is_reported_for_review(client, team):
    csv = "Issue key,Summary,Assignee\nPROJ-1,Fix,departed@elsewhere.com\n"
    report = upload(client, team, csv).json()

    match = next(m for m in report["users"] if m["source"] == "departed@elsewhere.com")
    assert match["matched_user_id"] is None
    assert any("not members of this team" in w for w in report["warnings"])


def test_an_unmatched_assignee_leaves_the_issue_unassigned(client, team):
    csv = "Issue key,Summary,Assignee\nPROJ-1,Fix,departed@elsewhere.com\n"
    upload(client, team, csv, dry_run=False)
    assert issues(client, team)[0]["assignee"] is None


def test_an_unmatched_comment_author_is_named_in_the_comment(client, team):
    """Rather than silently attributing their words to whoever ran the
    import."""
    csv = (
        "Issue key,Summary,Comment\n"
        'PROJ-1,Fix,"12/Mar/24 9:00 AM;departed@elsewhere.com;My analysis"\n'
    )
    upload(client, team, csv, dry_run=False)
    issue = issues(client, team)[0]
    body = client.get(
        f"/issues/{issue['id']}/comments", headers=team["headers"]
    ).json()["items"][0]["body"]

    assert "departed@elsewhere.com" in body
    assert "My analysis" in body


# --- re-running ---------------------------------------------------------


def test_importing_the_same_file_twice_does_not_duplicate_the_board(client, team):
    """Which is what makes an import safe to retry after a partial failure."""
    upload(client, team, dry_run=False)
    second = upload(client, team, dry_run=False).json()

    assert second["issues_created"] == 0
    assert second["issues_skipped_existing"] == 2
    assert len(issues(client, team)) == 2


def test_issues_without_a_key_are_flagged_as_not_repeatable(client, team):
    report = upload(client, team, "Summary\nFix\n").json()
    assert any("no Jira key" in warning for warning in report["warnings"])


def test_a_duplicate_key_inside_one_file_is_imported_once(client, team):
    csv = "Issue key,Summary\nPROJ-1,Fix\nPROJ-1,Fix again\n"
    report = upload(client, team, csv, dry_run=False).json()
    assert report["issues_created"] == 1
    assert report["issues_skipped_existing"] == 1


# --- reporting ----------------------------------------------------------


def test_unmapped_statuses_are_listed_so_they_can_be_fixed_in_bulk(client, team):
    csv = "Issue key,Summary,Status\nPROJ-1,Fix,Awaiting Legal Sign-off\n"
    report = upload(client, team).json()
    report = upload(client, team, csv).json()

    assert report["unmapped_statuses"] == ["Awaiting Legal Sign-off"]
    assert any("land in the first column" in warning for warning in report["warnings"])
    assert report["preview"][0]["status"] == "backlog"  # the category, pre-import


def test_the_preview_shows_what_is_coming(client, team):
    report = upload(client, team).json()
    assert [issue["title"] for issue in report["preview"]] == [
        "Fix login",
        "Add logout",
    ]


# --- refusals -----------------------------------------------------------


def test_a_file_that_is_not_an_export_is_refused_with_a_reason(client, team):
    response = upload(client, team, "Board,Column\nMain,To Do\n")
    assert response.status_code == 422
    assert "Summary" in response.json()["detail"]


def test_an_empty_file_is_refused(client, team):
    assert upload(client, team, "").status_code == 422


def test_json_exports_work_too(client, team):
    payload = json.dumps(
        {"issues": [{"key": "PROJ-3", "fields": {"summary": "From JSON"}}]}
    )
    report = upload(client, team, payload, name="export.json", dry_run=False).json()
    assert report["issues_created"] == 1
    assert issues(client, team)[0]["external_key"] == "PROJ-3"


def test_a_utf8_bom_does_not_break_the_header(client, team):
    """Jira exports from the Cloud UI frequently carry one, and a stray BOM
    corrupts the first column name so every lookup against it fails."""
    response = client.post(
        f"/teams/{team['team']['id']}/import/jira",
        files={
            "file": (
                "jira.csv",
                io.BytesIO(b"\xef\xbb\xbf" + b"Issue key,Summary\nPROJ-1,Fix\n"),
                "text/csv",
            )
        },
        data={"dry_run": "false"},
        headers=team["headers"],
    )
    assert response.status_code == 200
    assert response.json()["issues_created"] == 1
    assert issues(client, team)[0]["external_key"] == "PROJ-1"


def test_importing_into_another_team_is_refused(client, team, auth):
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    response = client.post(
        f"/teams/{team['team']['id']}/import/jira",
        files={"file": ("jira.csv", io.BytesIO(CSV.encode()), "text/csv")},
        data={"dry_run": "true"},
        headers=outsider["headers"],
    )
    assert response.status_code in (403, 404)
