"""Department budgets (#134), against actuals summed from real rows."""

from datetime import date

import pytest

from tests.test_compensation import people, record  # noqa: F401 -- fixture
from tests.test_expenses import decide, submit
from tests.test_payroll import act, adjust, create
from tests.test_reimbursements import call

Q3 = "?start=2026-07-01&end=2026-09-30"


def department(client, sofia, name, *members):
    created = call(client, sofia, "POST", "/departments", json={"name": name})
    for person in members:
        call(
            client,
            sofia,
            "PATCH",
            f"/admin/users/{person['user']['id']}",
            json={"department_id": created["id"]},
        )
    return created


@pytest.fixture
def spent(client, people):  # noqa: F811 -- the imported fixture
    """A quarter of spend.

    Engineering is Daniel (USD) and Amina (GBP), Finance is Grace (GBP), and
    Ben (EUR) is in no department. July and August runs are approved,
    September's is a draft. Daniel's hotel is paid back; Amina's monitor is
    approved and still waiting; Ben's taxi is paid back. Then Daniel moves to
    Finance -- after all of it was approved.
    """
    sofia, grace = people["sofia"], people["grace"]
    engineering = department(
        client, sofia, "Engineering", people["daniel"], people["amina"]
    )
    finance = department(client, sofia, "Finance", grace)
    design = department(client, sofia, "Design")
    for username, amount, currency in (
        ("daniel", 795000, "USD"),
        ("amina", 645000, "GBP"),
        ("grace", 710000, "GBP"),
        ("ben", 500000, "EUR"),
    ):
        record(
            client,
            grace,
            username,
            amount_minor=amount,
            currency=currency,
            effective_on=date(2024, 1, 1),
        )

    july = create(client, grace, period_start="2026-07-01", period_end="2026-07-31")
    adjust(client, grace, july, people["daniel"])  # +400.00, on-call
    act(client, grace, july, "approve")
    august = create(client, grace, period_start="2026-08-01", period_end="2026-08-31")
    act(client, grace, august, "approve")
    act(client, grace, august, "paid")
    create(client, grace)  # September, a draft: not an actual yet

    hotel = submit(client, people["daniel"], incurred_on="2026-08-14")
    monitor = submit(
        client, people["amina"], amount_minor=124900, incurred_on="2026-08-20"
    )
    taxi = submit(client, people["ben"], amount_minor=8600, incurred_on="2026-09-02")
    for claim in (hotel, monitor, taxi):
        decide(client, grace, claim, "approve")
    batch = call(
        client,
        grace,
        "POST",
        "/finance/reimbursements/batches",
        json={"expense_ids": [hotel["id"], taxi["id"]]},
    )
    call(
        client, grace, "POST", f"/finance/reimbursements/batches/{batch['id']}/approve"
    )
    call(client, grace, "POST", f"/finance/reimbursements/batches/{batch['id']}/paid")

    call(
        client,
        sofia,
        "PATCH",
        f"/admin/users/{people['daniel']['user']['id']}",
        json={"department_id": finance["id"]},
    )
    return {
        **people,
        "engineering": engineering,
        "finance": finance,
        "design": design,
        "july": july,
        "august": august,
        "batch": batch,
    }


def budget(client, spent, department, amount, currency, status=200, **period):
    return call(
        client,
        spent["grace"],
        "POST",
        "/finance/budgets",
        status=status,
        json={
            "department_id": spent[department]["id"],
            "period_start": "2026-07-01",
            "period_end": "2026-09-30",
            "amount_minor": amount,
            "currency": currency,
            **period,
        },
    )


def rows(overview):
    return [
        (
            row["department"]["name"] if row["department"] else None,
            row["currency"],
            row["budget"]["amount_minor"] if row["budget"] else None,
            row["actual_minor"],
        )
        for row in overview["rows"]
    ]


def test_budgets_are_finance_only(client, people):  # noqa: F811
    for someone in (people["sofia"], people["daniel"]):
        response = client.get(f"/finance/budgets{Q3}", headers=someone["headers"])
        assert response.status_code == 403
        assert response.json()["code"] == "not_finance_admin"


def test_actuals_are_summed_from_approved_lines_and_reimbursed_claims(client, spent):
    budget(client, spent, "engineering", 1_700_000, "USD")
    budget(client, spent, "engineering", 1_300_000, "GBP")
    budget(client, spent, "finance", 1_300_000, "GBP")
    budget(client, spent, "design", 500_000, "EUR")

    overview = call(client, spent["grace"], "GET", f"/finance/budgets{Q3}")
    assert (overview["period_start"], overview["period_end"]) == (
        "2026-07-01",
        "2026-09-30",
    )
    assert rows(overview) == [
        # A budget with nothing spent against it yet.
        ("Design", "EUR", 500_000, 0),
        # Daniel's hotel: reimbursed, and Engineering's when approved. Amina's
        # monitor is approved but not paid back, so not an actual yet.
        ("Engineering", "EUR", None, 41240),
        # Amina, July and August. September is a draft.
        ("Engineering", "GBP", 1_300_000, 1_290_000),
        # Daniel, July with its adjustment and August -- still Engineering's
        # although he has moved to Finance since.
        ("Engineering", "USD", 1_700_000, 835000 + 795000),
        ("Finance", "GBP", 1_300_000, 1_420_000),
        # Ben has no department: a row you can see, not money gone missing.
        (None, "EUR", None, 1_000_000 + 8600),
    ]


def test_only_a_budget_for_exactly_the_period_is_shown(client, spent):
    budget(client, spent, "engineering", 600_000, "USD", period_end="2026-07-31")
    july = call(
        client,
        spent["grace"],
        "GET",
        "/finance/budgets?start=2026-07-01&end=2026-07-31",
    )
    assert ("Engineering", "USD", 600_000, 835000) in rows(july)
    quarter = call(client, spent["grace"], "GET", f"/finance/budgets{Q3}")
    assert ("Engineering", "USD", None, 1_630_000) in rows(quarter)


def test_where_an_actual_comes_from(client, spent):
    grace = spent["grace"]
    usd = call(
        client,
        grace,
        "GET",
        f"/finance/budgets/actuals{Q3}&currency=USD"
        f"&department_id={spent['engineering']['id']}",
    )
    assert usd["department"]["name"] == "Engineering"
    assert usd["total_minor"] == 1_630_000
    assert [
        (s["kind"], s["id"], s["period_start"], s["rows"], s["amount_minor"])
        for s in usd["sources"]
    ] == [
        ("payroll_run", spent["july"]["id"], "2026-07-01", 1, 835000),
        ("payroll_run", spent["august"]["id"], "2026-08-01", 1, 795000),
    ]

    eur = call(
        client,
        grace,
        "GET",
        f"/finance/budgets/actuals{Q3}&currency=EUR"
        f"&department_id={spent['engineering']['id']}",
    )
    assert [
        (s["kind"], s["id"], s["rows"], s["amount_minor"]) for s in eur["sources"]
    ] == [("reimbursement_batch", spent["batch"]["id"], 1, 41240)]

    unattributed = call(
        client, grace, "GET", f"/finance/budgets/actuals{Q3}&currency=EUR"
    )
    assert unattributed["department"] is None
    assert [(s["kind"], s["amount_minor"]) for s in unattributed["sources"]] == [
        ("payroll_run", 500000),
        ("payroll_run", 500000),
        ("reimbursement_batch", 8600),
    ]


def test_one_budget_per_department_period_and_currency(client, spent):
    first = budget(client, spent, "engineering", 1_700_000, "USD")
    twice = budget(client, spent, "engineering", 1, "USD", status=409)
    assert twice["code"] == "budget_exists"
    assert twice["detail"].startswith("Engineering already has a USD budget")
    # Another currency, or another period, is another budget.
    budget(client, spent, "engineering", 1, "EUR")
    budget(client, spent, "engineering", 1, "USD", period_end="2026-07-31")

    grace = spent["grace"]
    changed = call(
        client,
        grace,
        "PATCH",
        f"/finance/budgets/{first['id']}",
        json={"amount_minor": 1_800_000},
    )
    assert changed["amount_minor"] == 1_800_000
    backwards = call(
        client,
        grace,
        "PATCH",
        f"/finance/budgets/{first['id']}",
        status=400,
        json={"period_end": "2026-06-30"},
    )
    assert backwards["code"] == "budget_period_invalid"

    assert (
        client.delete(
            f"/finance/budgets/{first['id']}", headers=grace["headers"]
        ).status_code
        == 204
    )
    gone = call(client, grace, "DELETE", f"/finance/budgets/{first['id']}", status=404)
    assert gone["code"] == "budget_not_found"


def test_a_budget_names_a_real_department_and_a_period_that_runs_forwards(
    client, spent
):
    grace = spent["grace"]
    # The same answer an admin gets for a department that is not there.
    missing = call(
        client,
        grace,
        "POST",
        "/finance/budgets",
        status=400,
        json={
            "department_id": 999,
            "period_start": "2026-07-01",
            "period_end": "2026-09-30",
            "amount_minor": 1,
            "currency": "EUR",
        },
    )
    assert missing["code"] == "department_not_found"
    budget(client, spent, "design", 1, "EUR", status=422, period_end="2026-06-01")
    backwards = call(
        client,
        grace,
        "GET",
        "/finance/budgets?start=2026-09-30&end=2026-07-01",
        status=400,
    )
    assert backwards["code"] == "budget_period_invalid"


def test_a_budgeted_department_is_renamed_not_deleted(client, spent):
    budget(client, spent, "design", 500_000, "EUR")
    refused = client.delete(
        f"/departments/{spent['design']['id']}", headers=spent["sofia"]["headers"]
    )
    assert refused.status_code == 409
    assert refused.json()["code"] == "department_has_finance_history"
