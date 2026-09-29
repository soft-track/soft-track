"""Payroll runs (#132): generated, reviewed, approved, exported -- never paid."""

from datetime import date

import pytest

from tests.test_compensation import people, record  # noqa: F401 -- fixture

SEPTEMBER = {"period_start": "2026-09-01", "period_end": "2026-09-30"}


@pytest.fixture
def paid(client, people):  # noqa: F811 -- the imported fixture
    """Amina in pounds and Daniel in dollars monthly, Sofia semi-monthly, and
    nothing at all for Ben or Grace."""
    grace = people["grace"]
    record(
        client,
        grace,
        "amina",
        amount_minor=645000,
        currency="GBP",
        effective_on=date(2024, 2, 1),
    )
    record(client, grace, "daniel", amount_minor=795000, effective_on=date(2023, 8, 14))
    record(
        client,
        grace,
        "sofia",
        amount_minor=310000,
        pay_schedule="semi_monthly",
        effective_on=date(2023, 11, 20),
    )
    return people


def create(client, actor, status=200, **body):
    response = client.post(
        "/finance/payroll/runs",
        json={"pay_schedule": "monthly", **SEPTEMBER, **body},
        headers=actor["headers"],
    )
    assert response.status_code == status, response.text
    return response.json()


def get(client, actor, run_id):
    response = client.get(f"/finance/payroll/runs/{run_id}", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def adjust(client, actor, run, person, status=200, **body):
    response = client.put(
        f"/finance/payroll/runs/{run['id']}/lines/{person['user']['id']}/adjustment",
        json={"amount_minor": 40000, "note": "On-call, 4 weekends", **body},
        headers=actor["headers"],
    )
    assert response.status_code == status, response.text
    return response.json()


def act(client, actor, run, verb, status=200):
    response = client.post(
        f"/finance/payroll/runs/{run['id']}/{verb}", headers=actor["headers"]
    )
    assert response.status_code == status, response.text
    return response.json()


def lines(run):
    return [
        (line["person"]["username"], line["total_minor"], line["currency"])
        for line in run["lines"]
    ]


def test_nobody_else_sees_a_run_not_even_the_site_admin(client, paid):
    run = create(client, paid["grace"])
    for someone in (paid["sofia"], paid["amina"]):
        for response in (
            client.get("/finance/payroll/runs", headers=someone["headers"]),
            client.get(
                f"/finance/payroll/runs/{run['id']}", headers=someone["headers"]
            ),
            client.post(
                "/finance/payroll/runs",
                json={"pay_schedule": "monthly", **SEPTEMBER},
                headers=someone["headers"],
            ),
            client.post(
                f"/finance/payroll/runs/{run['id']}/approve", headers=someone["headers"]
            ),
            client.get(
                f"/finance/payroll/runs/{run['id']}/export", headers=someone["headers"]
            ),
        ):
            assert response.status_code == 403
            assert response.json()["code"] == "not_finance_admin"


def test_a_draft_has_everybody_on_its_schedule_and_the_missing_last(client, paid):
    run = create(client, paid["grace"])

    assert run["state"] == "draft"
    assert run["created_by"]["username"] == "grace"
    # Sofia is paid semi-monthly: another run's line, not this one's.
    assert lines(run) == [
        ("amina", 645000, "GBP"),
        ("daniel", 795000, "USD"),
        ("ben", None, None),
        ("grace", None, None),
    ]
    assert [line["missing"] for line in run["lines"]] == [False, False, True, True]
    assert (run["line_count"], run["missing_count"]) == (4, 2)
    assert [(t["currency"], t["amount_minor"], t["lines"]) for t in run["totals"]] == [
        ("GBP", 645000, 1),
        ("USD", 795000, 1),
    ]


def test_a_semi_monthly_run_has_its_own_people(client, paid):
    run = create(
        client,
        paid["grace"],
        pay_schedule="semi_monthly",
        period_start="2026-09-16",
        period_end="2026-09-30",
    )
    assert lines(run)[0] == ("sofia", 310000, "USD")
    assert [line["person"]["username"] for line in run["lines"] if line["missing"]] == [
        "ben",
        "grace",
    ]


def test_runs_on_one_schedule_never_overlap(client, paid):
    grace = paid["grace"]
    create(client, grace)

    clash = create(
        client, grace, status=409, period_start="2026-09-15", period_end="2026-10-14"
    )
    assert clash["code"] == "payroll_run_overlaps"
    assert clash["detail"] == "A monthly run already covers 2026-09-01 to 2026-09-30"
    # Another schedule may cover the same days, and the next month is free.
    create(
        client,
        grace,
        pay_schedule="semi_monthly",
        period_start="2026-09-01",
        period_end="2026-09-15",
    )
    create(client, grace, period_start="2026-10-01", period_end="2026-10-31")
    # A period runs forwards.
    create(
        client, grace, status=422, period_start="2026-12-31", period_end="2026-12-01"
    )


def test_a_draft_follows_pay_recorded_after_it_was_generated(client, paid):
    grace = paid["grace"]
    run = create(client, grace)

    # Ben's pay is recorded, and Daniel's raise lands before the period ends;
    # a raise from October does not.
    record(
        client,
        grace,
        "ben",
        amount_minor=500000,
        currency="EUR",
        effective_on=date(2026, 9, 1),
    )
    record(
        client,
        grace,
        "daniel",
        amount_minor=835000,
        kind="raise",
        effective_on=date(2026, 9, 15),
    )
    record(
        client,
        grace,
        "amina",
        amount_minor=700000,
        currency="GBP",
        kind="raise",
        effective_on=date(2026, 10, 1),
    )

    assert lines(get(client, grace, run["id"])) == [
        ("amina", 645000, "GBP"),
        ("ben", 500000, "EUR"),
        ("daniel", 835000, "USD"),
        ("grace", None, None),
    ]


def test_an_adjustment_is_one_off_in_the_line_currency_with_a_reason(client, paid):
    grace, daniel = paid["grace"], paid["daniel"]
    run = create(client, grace)

    adjusted = adjust(client, grace, run, daniel)
    line = next(l for l in adjusted["lines"] if l["person"]["username"] == "daniel")
    assert (line["amount_minor"], line["adjustment_minor"], line["total_minor"]) == (
        795000,
        40000,
        835000,
    )
    assert line["adjustment_note"] == "On-call, 4 weekends"
    assert adjusted["totals"][1] == {
        "currency": "USD",
        "amount_minor": 835000,
        "lines": 1,
    }

    # Down is allowed, below zero is not.
    adjust(client, grace, run, daniel, amount_minor=-95000)
    too_far = adjust(client, grace, run, daniel, status=400, amount_minor=-795001)
    assert too_far["code"] == "payroll_adjustment_too_large"

    # A reason, and an amount.
    adjust(client, grace, run, daniel, status=422, note="   ")
    adjust(client, grace, run, daniel, status=422, amount_minor=0)

    cleared = client.delete(
        f"/finance/payroll/runs/{run['id']}/lines/{daniel['user']['id']}/adjustment",
        headers=grace["headers"],
    ).json()
    line = next(l for l in cleared["lines"] if l["person"]["username"] == "daniel")
    assert (line["adjustment_minor"], line["total_minor"]) == (0, 795000)


def test_only_a_line_with_pay_on_the_run_takes_an_adjustment(client, paid):
    grace = paid["grace"]
    run = create(client, grace)

    missing = adjust(client, grace, run, paid["ben"], status=409)
    assert missing["code"] == "payroll_line_missing_pay"
    elsewhere = adjust(client, grace, run, paid["sofia"], status=404)
    assert elsewhere["code"] == "payroll_line_not_found"


def test_approval_freezes_what_the_run_pays(client, paid, session):
    grace, sofia = paid["grace"], paid["sofia"]
    engineering = client.post(
        "/departments", json={"name": "Engineering"}, headers=sofia["headers"]
    ).json()
    client.patch(
        f"/admin/users/{paid['daniel']['user']['id']}",
        json={"department_id": engineering["id"]},
        headers=sofia["headers"],
    )
    run = create(client, grace)
    adjust(client, grace, run, paid["daniel"])

    approved = act(client, grace, run, "approve")
    assert approved["state"] == "approved"
    assert approved["approved_by"]["username"] == "grace"
    assert approved["approved_at"] is not None

    # Everything that could move it, moved.
    record(
        client,
        grace,
        "daniel",
        amount_minor=999900,
        kind="raise",
        effective_on=date(2026, 9, 1),
    )
    record(
        client,
        grace,
        "ben",
        amount_minor=500000,
        currency="EUR",
        effective_on=date(2026, 9, 1),
    )
    client.patch(
        f"/admin/users/{paid['daniel']['user']['id']}",
        json={"department_id": None},
        headers=sofia["headers"],
    )

    after = get(client, grace, run["id"])
    assert lines(after) == [
        ("amina", 645000, "GBP"),
        ("daniel", 835000, "USD"),
        ("ben", None, None),
        ("grace", None, None),
    ]
    daniel = next(l for l in after["lines"] if l["person"]["username"] == "daniel")
    assert daniel["department"]["name"] == "Engineering"
    assert daniel["adjustment_note"] == "On-call, 4 weekends"
    assert (after["line_count"], after["missing_count"]) == (4, 2)


def test_an_approved_run_does_not_change(client, paid):
    grace = paid["grace"]
    run = create(client, grace)
    act(client, grace, run, "approve")

    for response in (
        client.put(
            f"/finance/payroll/runs/{run['id']}/lines/{paid['daniel']['user']['id']}/adjustment",
            json={"amount_minor": 100, "note": "late"},
            headers=grace["headers"],
        ),
        client.delete(f"/finance/payroll/runs/{run['id']}", headers=grace["headers"]),
        client.post(
            f"/finance/payroll/runs/{run['id']}/approve", headers=grace["headers"]
        ),
    ):
        assert response.status_code == 409
        assert response.json()["code"] == "payroll_run_not_draft"


def test_somebody_who_leaves_before_approval_takes_their_adjustment(client, paid):
    grace, sofia, daniel = paid["grace"], paid["sofia"], paid["daniel"]
    run = create(client, grace)
    adjust(client, grace, run, daniel)
    client.patch(
        f"/admin/users/{daniel['user']['id']}",
        json={"is_active": False},
        headers=sofia["headers"],
    )

    approved = act(client, grace, run, "approve")
    assert "daniel" not in {l["person"]["username"] for l in approved["lines"]}


def test_paid_is_said_by_a_finance_admin_once_approved(client, paid):
    grace = paid["grace"]
    run = create(client, grace)

    early = act(client, grace, run, "paid", status=409)
    assert early["code"] == "payroll_run_not_approved"

    act(client, grace, run, "approve")
    done = act(client, grace, run, "paid")
    assert done["state"] == "paid"
    assert done["paid_by"]["username"] == "grace"
    assert (
        act(client, grace, run, "paid", status=409)["code"]
        == "payroll_run_not_approved"
    )


def test_the_export_is_the_approved_run_for_a_bank_template(client, paid, session):
    from lib_softtrack.tables import User

    grace = paid["grace"]
    # A name a spreadsheet would run.
    amina = session.get(User, paid["amina"]["user"]["id"])
    amina.full_name = "=HYPERLINK(1)"
    session.add(amina)
    session.commit()
    run = create(client, grace)
    adjust(client, grace, run, paid["daniel"])

    draft = client.get(
        f"/finance/payroll/runs/{run['id']}/export", headers=grace["headers"]
    )
    assert draft.status_code == 409
    assert draft.json()["code"] == "payroll_run_not_approved"

    act(client, grace, run, "approve")
    response = client.get(
        f"/finance/payroll/runs/{run['id']}/export", headers=grace["headers"]
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="payroll-2026-09-01-monthly.csv"'
    )
    assert response.content.startswith("﻿".encode())
    assert response.content.decode("utf-8-sig").split("\r\n") == [
        "name,amount,currency,period_start,period_end,kind",
        "'=HYPERLINK(1),6450.00,GBP,2026-09-01,2026-09-30,wages",
        "Daniel Okafor,8350.00,USD,2026-09-01,2026-09-30,wages",
        "",
    ]


def test_the_list_is_newest_first_with_its_totals(client, paid):
    grace = paid["grace"]
    august = create(client, grace, period_start="2026-08-01", period_end="2026-08-31")
    act(client, grace, august, "approve")
    create(client, grace)

    response = client.get("/finance/payroll/runs", headers=grace["headers"])
    assert response.status_code == 200
    page = response.json()
    assert page["total"] == 2
    assert [(r["period_start"], r["state"]) for r in page["items"]] == [
        ("2026-09-01", "draft"),
        ("2026-08-01", "approved"),
    ]
    for run in page["items"]:
        # The draft worked out, the approved one summed where it is kept.
        assert [(t["currency"], t["amount_minor"]) for t in run["totals"]] == [
            ("GBP", 645000),
            ("USD", 795000),
        ]
        assert (run["line_count"], run["missing_count"]) == (4, 2)


def test_a_draft_can_be_thrown_away(client, paid):
    grace = paid["grace"]
    run = create(client, grace)
    adjust(client, grace, run, paid["daniel"])

    response = client.delete(
        f"/finance/payroll/runs/{run['id']}", headers=grace["headers"]
    )
    assert response.status_code == 204
    gone = client.get(f"/finance/payroll/runs/{run['id']}", headers=grace["headers"])
    assert gone.status_code == 404
    assert gone.json()["code"] == "payroll_run_not_found"
    # And its period is free again.
    create(client, grace)


def test_a_department_paid_under_is_renamed_not_deleted(client, paid):
    grace, sofia = paid["grace"], paid["sofia"]
    used = client.post(
        "/departments", json={"name": "Engineering"}, headers=sofia["headers"]
    ).json()
    unused = client.post(
        "/departments", json={"name": "Design"}, headers=sofia["headers"]
    ).json()
    client.patch(
        f"/admin/users/{paid['daniel']['user']['id']}",
        json={"department_id": used["id"]},
        headers=sofia["headers"],
    )
    act(client, grace, create(client, grace), "approve")
    client.patch(
        f"/admin/users/{paid['daniel']['user']['id']}",
        json={"department_id": None},
        headers=sofia["headers"],
    )

    refused = client.delete(f"/departments/{used['id']}", headers=sofia["headers"])
    assert refused.status_code == 409
    assert refused.json()["code"] == "department_has_finance_history"
    assert (
        client.delete(
            f"/departments/{unused['id']}", headers=sofia["headers"]
        ).status_code
        == 204
    )
