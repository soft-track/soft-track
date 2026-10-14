"""Test runs (#275): a pass through the test cases, with results and the bugs
they raised.

A run is a selection of cases -- a folder's, a label's, or picked -- for a
release, a sprint or an epic, in an environment, owned by somebody. Each case
gets a result with a note, a failed step and files. A failure raises a bug
that arrives filled in and linked. A closed run's results are fixed, and a
case's history lists every run it has been in, with the version each ran.
"""

import io

import pytest

from tests.conftest import delete_for_good

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f"
    b"\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def _code(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["code"] == code, response.text


@pytest.fixture
def lab(client, team):
    """Engineering with a release, two folders of cases, a label and a story."""
    team_id = team["team"]["id"]
    h = team["headers"]

    def post(path, **body):
        return _ok(client.post(path, json=body, headers=h))

    release = post(f"/teams/{team_id}/releases", name="1.4.0")
    story = post(
        f"/teams/{team_id}/tickets",
        title="Portal: sign-in with magic link",
        type="story",
    )
    sign_in = post(f"/teams/{team_id}/test-folders", name="Sign-in")
    invoices = post(f"/teams/{team_id}/test-folders", name="Invoices")
    smoke = post(f"/teams/{team_id}/labels", name="Smoke")
    steps = [
        {"action": "Ask for a sign-in link.", "expected": "An email with a link."},
        {"action": "Open it.", "expected": "Signed in."},
        {"action": "Sign out.", "expected": "Signed out."},
        {"action": "Open it again.", "expected": "The link is refused."},
    ]
    once = post(
        f"/teams/{team_id}/test-cases",
        title="A sign-in link works once",
        steps=steps,
        folder_id=sign_in["id"],
        state="ready",
        ticket_ids=[story["id"]],
    )
    expires = post(
        f"/teams/{team_id}/test-cases",
        title="A sign-in link expires",
        folder_id=sign_in["id"],
        state="ready",
    )
    post(
        f"/teams/{team_id}/test-cases",
        title="Links by post",
        folder_id=sign_in["id"],
        state="retired",
    )
    pdf = post(
        f"/teams/{team_id}/test-cases",
        title="An invoice downloads as a PDF",
        folder_id=invoices["id"],
        label_ids=[smoke["id"]],
        state="ready",
    )
    lists = post(
        f"/teams/{team_id}/test-cases",
        title="The list pages past 50 invoices",
        folder_id=invoices["id"],
    )

    def run(**fields):
        body = {"name": "1.4.0 regression", **fields}
        return _ok(client.post(f"/teams/{team_id}/test-runs", json=body, headers=h))

    def result(run_case, **fields):
        return client.patch(f"/test-run-cases/{run_case['id']}", json=fields, headers=h)

    return {
        **team,
        "team_id": team_id,
        "h": h,
        "release": release,
        "story": story,
        "sign_in": sign_in,
        "smoke": smoke,
        "once": once,
        "expires": expires,
        "pdf": pdf,
        "lists": lists,
        "run": run,
        "result": result,
    }


def by_identifier(detail):
    return {case["identifier"]: case for case in detail["cases"]}


def test_a_run_takes_a_folders_a_labels_and_picked_cases_but_none_retired(client, lab):
    made = lab["run"](
        release_id=lab["release"]["id"],
        environment="staging",
        owner_id=lab["user"]["id"],
        folder_id=lab["sign_in"]["id"],
        label_id=lab["smoke"]["id"],
        case_ids=[lab["pdf"]["id"]],
    )
    run = made["run"]
    assert (run["name"], run["release_id"], run["environment"], run["state"]) == (
        "1.4.0 regression",
        lab["release"]["id"],
        "Staging",
        "open",
    )
    assert run["owner"]["id"] == lab["user"]["id"]
    assert [case["title"] for case in made["cases"]] == [
        "A sign-in link works once",
        "A sign-in link expires",
        "An invoice downloads as a PDF",
    ]
    assert run["progress"] == {
        "total": 3,
        "passed": 0,
        "failed": 0,
        "blocked": 0,
        "skipped": 0,
        "not_run": 3,
        "bugs": 0,
    }
    once = by_identifier(made)["TC-1"]
    assert once["covers"] == ["ENG-1"]
    assert len(once["steps"]) == 4

    _code(
        client.post(
            f"/teams/{lab['team_id']}/test-runs",
            json={"name": "Empty"},
            headers=lab["h"],
        ),
        422,
        "test_run_empty",
    )


def test_each_case_gets_a_result_and_the_run_a_tally(client, lab):
    made = lab["run"](folder_id=lab["sign_in"]["id"], case_ids=[lab["pdf"]["id"]])
    cases = by_identifier(made)

    assigned = _ok(lab["result"](cases["TC-4"], assignee_id=lab["user"]["id"]))
    assert assigned["assignee"]["id"] == lab["user"]["id"]
    assert assigned["result"] is None

    failed = _ok(
        lab["result"](
            cases["TC-1"],
            result="failed",
            failed_step=4,
            note="The link signed in a second time.",
        )
    )
    assert (failed["result"], failed["failed_step"], failed["note"]) == (
        "failed",
        4,
        "The link signed in a second time.",
    )
    assert failed["ran_by"]["id"] == lab["user"]["id"]
    assert failed["ran_at"] is not None
    # A step only fails in a failure.
    blocked = _ok(lab["result"](cases["TC-2"], result="blocked", failed_step=2))
    assert blocked["failed_step"] is None
    _ok(lab["result"](cases["TC-4"], result="passed"))

    run = _ok(client.get(f"/test-runs/{made['run']['id']}", headers=lab["h"]))["run"]
    assert run["progress"] == {
        "total": 3,
        "passed": 1,
        "failed": 1,
        "blocked": 1,
        "skipped": 0,
        "not_run": 0,
        "bugs": 0,
    }

    # Not run yet, again.
    cleared = _ok(lab["result"](cases["TC-4"], result=None))
    assert (cleared["result"], cleared["ran_at"]) == (None, None)


def test_a_failure_raises_a_bug_that_arrives_filled_in_and_linked(client, lab):
    made = lab["run"](
        release_id=lab["release"]["id"],
        environment="Staging",
        case_ids=[lab["once"]["id"]],
    )
    once = made["cases"][0]
    url = f"/test-run-cases/{once['id']}/bug"
    bug_body = {
        "title": "A sign-in link works twice",
        "description": "## Steps to reproduce\n\n1. Ask for a sign-in link.",
        "severity": "major",
        "environment": "Staging",
        "found_in_id": lab["release"]["id"],
    }

    # Only a failure raises a bug.
    _code(
        client.post(url, json=bug_body, headers=lab["h"]), 409, "test_result_not_failed"
    )
    _ok(lab["result"](once, result="failed", failed_step=4))

    bug = _ok(client.post(url, json=bug_body, headers=lab["h"]))
    assert (bug["type"], bug["severity"], bug["environment"], bug["found_in_id"]) == (
        "bug",
        "major",
        "Staging",
        lab["release"]["id"],
    )

    # The result links to the bug, and the bug to the story the case covers.
    after = by_identifier(
        _ok(client.get(f"/test-runs/{made['run']['id']}", headers=lab["h"]))
    )
    assert after["TC-1"]["bug"]["identifier"] == bug["identifier"]
    assert (
        _ok(client.get(f"/test-runs/{made['run']['id']}", headers=lab["h"]))["run"][
            "progress"
        ]["bugs"]
        == 1
    )
    links = _ok(client.get(f"/tickets/{bug['id']}/links", headers=lab["h"]))
    assert lab["story"]["identifier"] in str(links)

    # Its history begins with the result that raised it, and has the next.
    _ok(lab["result"](once, result="passed"))
    events = _ok(client.get(f"/tickets/{bug['id']}/events", headers=lab["h"]))
    results = [e["new_value"] for e in events if e["field"] == "test_result"]
    assert results == [
        "raised|TC-1|1.4.0 regression",
        "passed|TC-1|1.4.0 regression",
    ]

    # One bug a failure.
    _ok(lab["result"](once, result="failed"))
    _code(
        client.post(url, json=bug_body, headers=lab["h"]), 409, "test_result_not_failed"
    )


def test_a_purged_bug_leaves_the_result_without_a_link(client, lab):
    made = lab["run"](case_ids=[lab["once"]["id"]])
    once = made["cases"][0]
    _ok(lab["result"](once, result="failed"))
    bug = _ok(
        client.post(
            f"/test-run-cases/{once['id']}/bug",
            json={"title": "Works twice"},
            headers=lab["h"],
        )
    )
    assert delete_for_good(client, lab["h"], bug["id"]).status_code == 204
    after = _ok(client.get(f"/test-runs/{made['run']['id']}", headers=lab["h"]))
    assert after["cases"][0]["bug"] is None


def test_a_closed_runs_results_are_fixed(client, lab):
    made = lab["run"](case_ids=[lab["once"]["id"]])
    run_id = made["run"]["id"]
    once = made["cases"][0]
    _ok(lab["result"](once, result="failed"))
    closed = _ok(client.post(f"/test-runs/{run_id}/close", headers=lab["h"]))["run"]
    assert closed["state"] == "closed"
    assert closed["closed_at"] is not None

    _code(lab["result"](once, result="passed"), 409, "test_run_closed")
    _code(
        client.patch(
            f"/test-runs/{run_id}", json={"name": "Renamed"}, headers=lab["h"]
        ),
        409,
        "test_run_closed",
    )
    _code(
        client.post(
            f"/test-run-cases/{once['id']}/bug",
            json={"title": "Late"},
            headers=lab["h"],
        ),
        409,
        "test_run_closed",
    )
    _code(
        client.post(
            f"/test-run-cases/{once['id']}/files",
            files={"file": ("shot.png", io.BytesIO(PNG), "image/png")},
            headers=lab["h"],
        ),
        409,
        "test_run_closed",
    )
    # And it is history: it cannot be deleted.
    _code(
        client.delete(f"/test-runs/{run_id}", headers=lab["h"]), 409, "test_run_closed"
    )


def test_an_open_run_made_by_mistake_can_be_deleted(client, lab, storage):
    made = lab["run"](case_ids=[lab["pdf"]["id"]])
    run_case = made["cases"][0]
    _ok(
        client.post(
            f"/test-run-cases/{run_case['id']}/files",
            files={"file": ("shot.png", io.BytesIO(PNG), "image/png")},
            headers=lab["h"],
        )
    )
    assert (
        client.delete(f"/test-runs/{made['run']['id']}", headers=lab["h"]).status_code
        == 204
    )
    _code(
        client.get(f"/test-runs/{made['run']['id']}", headers=lab["h"]),
        404,
        "test_run_not_found",
    )


def test_a_result_carries_files(client, lab):
    made = lab["run"](case_ids=[lab["pdf"]["id"]])
    run_case = made["cases"][0]
    file = _ok(
        client.post(
            f"/test-run-cases/{run_case['id']}/files",
            files={"file": ("blank page.png", io.BytesIO(PNG), "image/png")},
            headers=lab["h"],
        )
    )
    assert (file["filename"], file["content_type"]) == ("blank page.png", "image/png")
    listed = _ok(client.get(f"/test-runs/{made['run']['id']}", headers=lab["h"]))
    assert [f["id"] for f in listed["cases"][0]["files"]] == [file["id"]]

    content = client.get(f"/test-result-files/{file['id']}/content", headers=lab["h"])
    assert content.status_code == 200
    assert content.content == PNG
    assert content.headers["x-content-type-options"] == "nosniff"

    refused = client.post(
        f"/test-run-cases/{run_case['id']}/files",
        files={"file": ("script.exe", io.BytesIO(b"MZ"), "application/octet-stream")},
        headers=lab["h"],
    )
    assert refused.status_code == 415

    assert (
        client.delete(f"/test-result-files/{file['id']}", headers=lab["h"]).status_code
        == 204
    )
    listed = _ok(client.get(f"/test-runs/{made['run']['id']}", headers=lab["h"]))
    assert listed["cases"][0]["files"] == []


def test_a_case_run_after_run_with_the_version_each_executed(client, lab):
    once = lab["once"]
    first = lab["run"](name="1.3.2 regression", case_ids=[once["id"]])
    _ok(lab["result"](first["cases"][0], result="passed"))
    _ok(client.post(f"/test-runs/{first['run']['id']}/close", headers=lab["h"]))

    # The case changes; the result from before still says what was tested.
    _ok(
        client.patch(
            f"/test-cases/{once['id']}",
            json={"title": "A sign-in link works exactly once"},
            headers=lab["h"],
        )
    )
    second = lab["run"](name="1.4.0 regression", case_ids=[once["id"]])
    _ok(lab["result"](second["cases"][0], result="failed"))

    history = _ok(client.get(f"/test-cases/{once['id']}/runs", headers=lab["h"]))
    assert [(r["run_name"], r["version"], r["result"]) for r in history] == [
        ("1.4.0 regression", 2, "failed"),
        ("1.3.2 regression", 1, "passed"),
    ]
    old = _ok(client.get(f"/test-runs/{first['run']['id']}", headers=lab["h"]))
    assert old["cases"][0]["title"] == "A sign-in link works once"

    # The latest result is the case's, in the list and on the story.
    listed = {
        case["identifier"]: case
        for case in _ok(
            client.get(f"/teams/{lab['team_id']}/test-cases", headers=lab["h"])
        )
    }
    assert listed["TC-1"]["last_result"] == "failed"
    assert listed["TC-2"]["last_result"] is None
    on_story = _ok(
        client.get(f"/tickets/{lab['story']['id']}/test-cases", headers=lab["h"])
    )
    assert on_story["cases"][0]["last_result"] == "failed"

    # A case that has been run is retired, not deleted.
    _code(
        client.delete(f"/test-cases/{once['id']}", headers=lab["h"]),
        409,
        "test_case_has_runs",
    )


def test_a_releases_runs_and_what_goes_when_it_does(client, lab):
    release_id = lab["release"]["id"]
    lab["run"](name="Older", release_id=release_id, case_ids=[lab["pdf"]["id"]])
    latest = lab["run"](
        name="Latest", release_id=release_id, case_ids=[lab["pdf"]["id"]]
    )
    lab["run"](name="Elsewhere", case_ids=[lab["pdf"]["id"]])

    runs = _ok(
        client.get(
            f"/teams/{lab['team_id']}/test-runs",
            params={"release_id": release_id},
            headers=lab["h"],
        )
    )
    assert [run["name"] for run in runs] == ["Latest", "Older"]

    assert client.delete(f"/releases/{release_id}", headers=lab["h"]).status_code == 204
    kept = _ok(client.get(f"/test-runs/{latest['run']['id']}", headers=lab["h"]))
    assert kept["run"]["release_id"] is None


def test_what_a_run_names_is_its_teams(client, lab, auth):
    other = auth(email="ops@example.com", full_name="Ops Person")
    ops = _ok(
        client.post(
            "/teams", json={"name": "Ops", "key": "OPS"}, headers=other["headers"]
        )
    )
    theirs = _ok(
        client.post(
            f"/teams/{ops['id']}/releases",
            json={"name": "9.9"},
            headers=other["headers"],
        )
    )
    _code(
        client.post(
            f"/teams/{lab['team_id']}/test-runs",
            json={
                "name": "Elsewhere",
                "release_id": theirs["id"],
                "case_ids": [lab["pdf"]["id"]],
            },
            headers=lab["h"],
        ),
        400,
        "not_on_this_team",
    )
    _code(
        client.post(
            f"/teams/{lab['team_id']}/test-runs",
            json={
                "name": "Moon",
                "environment": "Moon base",
                "case_ids": [lab["pdf"]["id"]],
            },
            headers=lab["h"],
        ),
        400,
        "environment_not_on_team",
    )
