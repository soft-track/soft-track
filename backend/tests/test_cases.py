"""Test cases a team keeps (#274), linked to the stories they cover.

A case has a title, preconditions and numbered steps with what should
happen, an owner and a state, and is numbered per team. Folders group cases
one level deep and labels cut across them. A story lists the cases that cover
it. Changes to a case's text are kept as versions. Search finds cases, and
they import and export as CSV.
"""

import csv
import io

import pytest

from tests.conftest import delete_for_good


def _ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def _code(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["code"] == code, response.text


STEPS = [
    {"action": "Open Invoices.", "expected": "The list, newest first."},
    {"action": "Open the first invoice.", "expected": "Its page, with a total."},
    {"action": "Choose Download PDF.", "expected": "A PDF that matches the page."},
]


@pytest.fixture
def tests(client, team):
    team_id = team["team"]["id"]
    h = team["headers"]

    def folder(name):
        return _ok(
            client.post(
                f"/teams/{team_id}/test-folders", json={"name": name}, headers=h
            )
        )

    def case(title, **fields):
        return _ok(
            client.post(
                f"/teams/{team_id}/test-cases",
                json={"title": title, **fields},
                headers=h,
            )
        )

    def ticket(title, **fields):
        return _ok(
            client.post(
                f"/teams/{team_id}/tickets", json={"title": title, **fields}, headers=h
            )
        )

    def cases(**params):
        return _ok(client.get(f"/teams/{team_id}/test-cases", params=params, headers=h))

    return {
        **team,
        "team_id": team_id,
        "h": h,
        "folder": folder,
        "case": case,
        "ticket": ticket,
        "cases": cases,
    }


def test_a_case_is_written_down_with_numbered_steps(client, tests):
    invoices = tests["folder"]("Invoices")
    story = tests["ticket"]("Portal: invoice list page", type="story")
    made = tests["case"](
        "  An invoice downloads as a PDF ",
        preconditions="Signed in as a customer with at least one invoice.",
        steps=[*STEPS, {"action": "  ", "expected": ""}],
        folder_id=invoices["id"],
        owner_id=tests["user"]["id"],
        state="ready",
        ticket_ids=[story["id"]],
    )
    assert made["identifier"] == "TC-1"
    assert made["title"] == "An invoice downloads as a PDF"
    # A step with nothing in it is dropped.
    assert made["steps"] == STEPS
    assert (made["folder_id"], made["state"], made["version"]) == (
        invoices["id"],
        "ready",
        1,
    )
    assert made["owner"]["id"] == tests["user"]["id"]
    assert [ticket["identifier"] for ticket in made["covers"]] == ["ENG-1"]

    second = tests["case"]("An invoice opens from the list")
    assert second["identifier"] == "TC-2"
    assert second["state"] == "draft"


def test_folders_are_one_level_and_count_what_is_not_retired(client, tests):
    sign_in = tests["folder"]("Sign-in")
    invoices = tests["folder"]("Invoices")
    _code(
        client.post(
            f"/teams/{tests['team_id']}/test-folders",
            json={"name": "invoices"},
            headers=tests["h"],
        ),
        409,
        "test_folder_name_taken",
    )
    tests["case"]("Link works once", folder_id=sign_in["id"])
    tests["case"]("Link expires", folder_id=sign_in["id"], state="retired")
    tests["case"]("Opens", folder_id=invoices["id"])

    folders = _ok(
        client.get(f"/teams/{tests['team_id']}/test-folders", headers=tests["h"])
    )
    assert [(f["name"], f["case_count"]) for f in folders] == [
        ("Invoices", 1),
        ("Sign-in", 1),
    ]

    renamed = _ok(
        client.patch(
            f"/test-folders/{sign_in['id']}",
            json={"name": "Signing in"},
            headers=tests["h"],
        )
    )
    assert renamed["name"] == "Signing in"

    # Deleting a folder keeps its cases, in no folder.
    assert (
        client.delete(f"/test-folders/{sign_in['id']}", headers=tests["h"]).status_code
        == 204
    )
    loose = tests["cases"](no_folder=True)
    assert sorted(case["title"] for case in loose) == [
        "Link expires",
        "Link works once",
    ]


def test_cases_are_narrowed_by_folder_label_state_and_words(client, tests):
    regression = _ok(
        client.post(
            f"/teams/{tests['team_id']}/labels",
            json={"name": "Regression"},
            headers=tests["h"],
        )
    )
    invoices = tests["folder"]("Invoices")
    tests["case"](
        "An invoice opens", folder_id=invoices["id"], label_ids=[regression["id"]]
    )
    tests["case"]("The list pages past 50", folder_id=invoices["id"], steps=STEPS)
    tests["case"](
        "A sign-in link works once", label_ids=[regression["id"]], state="ready"
    )

    def titles(**params):
        return [case["title"] for case in tests["cases"](**params)]

    assert titles(folder_id=invoices["id"]) == [
        "An invoice opens",
        "The list pages past 50",
    ]
    # Labels cut across folders.
    assert titles(label_id=regression["id"]) == [
        "An invoice opens",
        "A sign-in link works once",
    ]
    assert titles(state="ready") == ["A sign-in link works once"]
    # The words are looked for in the steps too, and a key finds its case.
    assert titles(q="download pdf") == ["The list pages past 50"]
    assert titles(q="TC-3") == ["A sign-in link works once"]


def test_a_change_to_what_is_tested_is_a_new_version(client, tests):
    case = tests["case"]("An invoice downloads as a PDF", steps=STEPS[:2])
    url = f"/test-cases/{case['id']}"

    # The state and the folder change nothing about what is tested.
    unchanged = _ok(client.patch(url, json={"state": "ready"}, headers=tests["h"]))
    assert unchanged["version"] == 1

    second = _ok(
        client.patch(
            url,
            json={"preconditions": "Signed in as a customer."},
            headers=tests["h"],
        )
    )
    assert second["version"] == 2
    third = _ok(
        client.patch(
            url,
            json={"steps": STEPS, "change_note": "step 3 now names the PDF button"},
            headers=tests["h"],
        )
    )
    assert third["version"] == 3

    versions = _ok(client.get(f"{url}/versions", headers=tests["h"]))
    assert [(v["version"], v["note"]) for v in versions] == [
        (3, "step 3 now names the PDF button"),
        (2, None),
        (1, None),
    ]
    # What was tested at each version is kept as it was.
    assert versions[2]["steps"] == STEPS[:2]
    assert versions[2]["preconditions"] is None
    assert versions[0]["author"]["id"] == tests["user"]["id"]


def test_a_story_lists_the_cases_that_cover_it(client, tests):
    story = tests["ticket"]("Portal: invoice list page", type="story")
    bare = tests["ticket"]("Empty state for the statements page", type="story")

    # A team with no cases is not told a story has none.
    nothing = _ok(client.get(f"/tickets/{bare['id']}/test-cases", headers=tests["h"]))
    assert nothing == {"uses_test_cases": False, "cases": []}

    opens = tests["case"]("An invoice opens from the list", state="ready")
    pages = tests["case"]("The list pages past 50", ticket_ids=[story["id"]])
    tests["case"]("Invoices by post", ticket_ids=[story["id"]], state="retired")
    covered = _ok(
        client.post(
            f"/test-cases/{opens['id']}/tickets",
            json={"ticket_id": story["id"]},
            headers=tests["h"],
        )
    )
    assert [ticket["title"] for ticket in covered["covers"]] == [story["title"]]
    _code(
        client.post(
            f"/test-cases/{opens['id']}/tickets",
            json={"ticket_id": story["id"]},
            headers=tests["h"],
        ),
        409,
        "test_case_covers_already",
    )

    listed = _ok(client.get(f"/tickets/{story['id']}/test-cases", headers=tests["h"]))
    assert listed["uses_test_cases"] is True
    # Retired cases leave the list.
    assert [case["identifier"] for case in listed["cases"]] == [
        opens["identifier"],
        pages["identifier"],
    ]
    assert _ok(client.get(f"/tickets/{bare['id']}/test-cases", headers=tests["h"])) == {
        "uses_test_cases": True,
        "cases": [],
    }

    assert (
        client.delete(
            f"/test-cases/{opens['id']}/tickets/{story['id']}", headers=tests["h"]
        ).status_code
        == 204
    )
    listed = _ok(client.get(f"/tickets/{story['id']}/test-cases", headers=tests["h"]))
    assert [case["identifier"] for case in listed["cases"]] == [pages["identifier"]]


def test_what_a_case_names_is_on_its_team(client, tests, auth):
    other = auth(email="ops@example.com", full_name="Ops Person")
    ops = _ok(
        client.post(
            "/teams", json={"name": "Ops", "key": "OPS"}, headers=other["headers"]
        )
    )
    theirs = _ok(
        client.post(
            f"/teams/{ops['id']}/tickets",
            json={"title": "Theirs"},
            headers=other["headers"],
        )
    )
    folder = _ok(
        client.post(
            f"/teams/{ops['id']}/test-folders",
            json={"name": "Ops"},
            headers=other["headers"],
        )
    )
    for fields in (
        {"ticket_ids": [theirs["id"]]},
        {"folder_id": folder["id"]},
    ):
        _code(
            client.post(
                f"/teams/{tests['team_id']}/test-cases",
                json={"title": "Elsewhere", **fields},
                headers=tests["h"],
            ),
            400,
            "not_on_this_team",
        )
    _code(
        client.post(
            f"/teams/{tests['team_id']}/test-cases",
            json={"title": "Owned by a stranger", "owner_id": other["user"]["id"]},
            headers=tests["h"],
        ),
        400,
        "user_not_on_team",
    )


def test_a_ticket_that_goes_leaves_its_cases(client, tests):
    story = tests["ticket"]("Going", type="story")
    case = tests["case"]("Covers it", ticket_ids=[story["id"]])
    assert delete_for_good(client, tests["h"], story["id"]).status_code == 204
    assert (
        _ok(client.get(f"/test-cases/{case['id']}", headers=tests["h"]))["covers"] == []
    )


def test_moving_a_ticket_to_another_team_leaves_the_cases_behind(client, tests):
    story = tests["ticket"]("Moving", type="story")
    case = tests["case"]("Covers it", ticket_ids=[story["id"]])
    ops = _ok(
        client.post("/teams", json={"name": "Ops", "key": "OPS"}, headers=tests["h"])
    )
    _ok(
        client.post(
            f"/tickets/{story['id']}/transfer",
            json={"team_id": ops["id"]},
            headers=tests["h"],
        )
    )
    assert (
        _ok(client.get(f"/test-cases/{case['id']}", headers=tests["h"]))["covers"] == []
    )


def test_deleting_or_merging_a_label_takes_it_off_cases(client, tests):
    def label(name):
        return _ok(
            client.post(
                f"/teams/{tests['team_id']}/labels",
                json={"name": name},
                headers=tests["h"],
            )
        )

    smoke, regression, gone = label("Smoke"), label("Regression"), label("Old")
    case = tests["case"]("Opens", label_ids=[smoke["id"], gone["id"]])
    assert (
        client.delete(
            f"/labels/{smoke['id']}",
            params={"merge_into": regression["id"]},
            headers=tests["h"],
        ).status_code
        == 204
    )
    assert client.delete(f"/labels/{gone['id']}", headers=tests["h"]).status_code == 204
    labels = _ok(client.get(f"/test-cases/{case['id']}", headers=tests["h"]))["labels"]
    assert [label["name"] for label in labels] == ["Regression"]


def test_search_finds_cases_on_the_callers_teams(client, tests, auth):
    tests["case"]("An invoice downloads as a PDF", steps=STEPS)
    tests["case"]("A sign-in link works once")
    hits = _ok(
        client.get("/test-cases/search", params={"q": "pdf"}, headers=tests["h"])
    )
    assert [hit["identifier"] for hit in hits] == ["TC-1"]
    assert hits[0]["team_key"] == "ENG"

    stranger = auth(email="stranger@example.com", full_name="Stranger")
    assert (
        _ok(
            client.get(
                "/test-cases/search", params={"q": "pdf"}, headers=stranger["headers"]
            )
        )
        == []
    )


def test_a_case_nobody_ran_can_be_deleted(client, tests):
    case = tests["case"]("A draft that went nowhere", steps=STEPS)
    assert (
        client.delete(f"/test-cases/{case['id']}", headers=tests["h"]).status_code
        == 204
    )
    _code(
        client.get(f"/test-cases/{case['id']}", headers=tests["h"]),
        404,
        "test_case_not_found",
    )


def test_cases_export_and_import_as_csv(client, tests):
    regression = _ok(
        client.post(
            f"/teams/{tests['team_id']}/labels",
            json={"name": "Regression"},
            headers=tests["h"],
        )
    )
    story = tests["ticket"]("Portal: invoice list page", type="story")
    invoices = tests["folder"]("Invoices")
    tests["case"](
        "An invoice downloads as a PDF",
        preconditions="Signed in.",
        steps=STEPS,
        folder_id=invoices["id"],
        state="ready",
        label_ids=[regression["id"]],
        ticket_ids=[story["id"]],
    )

    exported = client.get(
        f"/teams/{tests['team_id']}/test-cases/export", headers=tests["h"]
    )
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("text/csv")
    text = exported.content.decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    assert rows[0]["key"] == "TC-1"
    assert rows[0]["steps"] == (
        "1. Open Invoices.\n2. Open the first invoice.\n3. Choose Download PDF."
    )
    assert rows[0]["covers"] == "ENG-1"

    # Imported back, the case that is there already is left alone...
    def upload(content, dry_run):
        return _ok(
            client.post(
                f"/teams/{tests['team_id']}/test-cases/import",
                files={"file": ("cases.csv", content.encode(), "text/csv")},
                data={"dry_run": "true" if dry_run else "false"},
                headers=tests["h"],
            )
        )

    again = upload(text, dry_run=False)
    assert (again["cases_created"], again["cases_skipped_existing"]) == (0, 1)

    # ...and new rows become cases, folders made by name.
    new = (
        "title,folder,state,labels,steps,expected,covers,owner\n"
        '"A sign-in link works once",Sign-in,ready,Regression;Unheard of,'
        '"1. Ask for a link.\n2. Open it twice.","1. An email.\n2. Refused.",ENG-1;ENG-99,'
        "nobody@nowhere\n"
    )
    preview = upload(new, dry_run=True)
    assert preview["cases_created"] == 1
    assert tests["cases"](q="sign-in link") == []

    report = upload(new, dry_run=False)
    assert report["folders_created"] == ["Sign-in"]
    assert len(report["warnings"]) == 3
    made = tests["cases"](q="sign-in link")[0]
    assert made["identifier"] == "TC-2"
    assert made["steps"] == [
        {"action": "Ask for a link.", "expected": "An email."},
        {"action": "Open it twice.", "expected": "Refused."},
    ]
    assert [label["name"] for label in made["labels"]] == ["Regression"]
    assert [ticket["identifier"] for ticket in made["covers"]] == ["ENG-1"]

    _code(
        client.post(
            f"/teams/{tests['team_id']}/test-cases/import",
            files={"file": ("cases.csv", b"name,steps\nx,y\n", "text/csv")},
            headers=tests["h"],
        ),
        422,
        "test_cases_import_invalid",
    )
