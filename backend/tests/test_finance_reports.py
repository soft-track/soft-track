"""Finance reports (#135): payroll cost and headcount, replayed from real rows."""

from datetime import date

import pytest

import lib_finance.reports
from tests.test_compensation import people, record  # noqa: F401 -- fixture
from tests.test_payroll import act, adjust, create
from tests.test_reimbursements import call


@pytest.fixture
def on(monkeypatch):
    """Read the reports on a given day."""

    def _on(day: date):
        monkeypatch.setattr(lib_finance.reports, "today", lambda: day)

    _on(date(2026, 9, 29))
    return _on


@pytest.fixture
def paid(client, people):  # noqa: F811 -- the imported fixture
    """Daniel in dollars, Amina and Grace in pounds, Ben in euros, Sofia with
    no pay at all. July's run is approved with an adjustment for Daniel,
    August's is paid, September's is a draft."""
    grace = people["grace"]
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
    create(client, grace)  # September, a draft
    return people


def report(client, actor, query=""):
    return call(client, actor, "GET", f"/finance/reports/payroll{query}")


def shown(body):
    return [month["month"] for month in body["months"]]


def months(body):
    return [
        (
            month["month"],
            month["runs"],
            month["draft_runs"],
            month["headcount"],
            [
                (cost["currency"], cost["amount_minor"], cost["people"])
                for cost in month["costs"]
            ],
        )
        for month in body["months"]
    ]


def test_reports_are_finance_only_not_even_the_site_admin(client, people):  # noqa: F811
    for someone in (people["sofia"], people["daniel"]):
        response = client.get("/finance/reports/payroll", headers=someone["headers"])
        assert response.status_code == 403
        assert response.json()["code"] == "not_finance_admin"


def test_nothing_is_drawn_before_a_run_is_approved(client, people, on):  # noqa: F811
    grace = people["grace"]
    record(client, grace, "daniel", effective_on=date(2024, 1, 1))
    create(client, grace)  # a draft is not a beginning
    assert report(client, grace) == {"begins_on": None, "months": []}


def test_payroll_cost_is_the_frozen_lines_month_by_month(client, paid, on):
    grace = paid["grace"]
    # After both approvals: a raise for Amina backdated into August, and Ben
    # leaving. Neither redraws a month that was approved.
    record(
        client,
        grace,
        "amina",
        amount_minor=700000,
        currency="GBP",
        effective_on=date(2026, 8, 1),
        kind="raise",
    )
    call(
        client,
        paid["sofia"],
        "PATCH",
        f"/admin/users/{paid['ben']['user']['id']}",
        json={"is_active": False},
    )

    body = report(client, grace)
    assert body["begins_on"] == "2026-07-01"
    assert months(body) == [
        # Sofia has no pay: on the run as missing, but nobody was paid for her.
        (
            "2026-07-01",
            1,
            0,
            4,
            [("EUR", 500000, 1), ("GBP", 1355000, 2), ("USD", 835000, 1)],
        ),
        (
            "2026-08-01",
            1,
            0,
            4,
            [("EUR", 500000, 1), ("GBP", 1355000, 2), ("USD", 795000, 1)],
        ),
        # September's run is a draft: an empty month, not August again.
        ("2026-09-01", 0, 1, 0, []),
    ]


def test_the_months_end_with_this_one_and_never_run_ahead(client, paid, on):
    grace = paid["grace"]
    on(date(2026, 11, 15))
    # October and November are there, empty: nothing ran in them.
    assert shown(report(client, grace)) == [
        "2026-07-01",
        "2026-08-01",
        "2026-09-01",
        "2026-10-01",
        "2026-11-01",
    ]
    # A window ends with this month, and never reaches before the beginning.
    assert shown(report(client, grace, "?months=2")) == ["2026-10-01", "2026-11-01"]
    assert shown(report(client, grace, "?months=6"))[0] == "2026-07-01"

    # A run approved ahead of its period is a record, not a projection.
    december = create(client, grace, period_start="2026-12-01", period_end="2026-12-31")
    act(client, grace, december, "approve")
    assert shown(report(client, grace))[-1] == "2026-12-01"


def test_somebody_paid_twice_in_a_month_is_one_person(client, people, on):  # noqa: F811
    grace = people["grace"]
    record(
        client,
        grace,
        "ben",
        amount_minor=250000,
        currency="EUR",
        pay_schedule="semi_monthly",
        effective_on=date(2024, 1, 1),
    )
    for start, end in (("2026-09-01", "2026-09-15"), ("2026-09-16", "2026-09-30")):
        run = create(
            client,
            grace,
            pay_schedule="semi_monthly",
            period_start=start,
            period_end=end,
        )
        act(client, grace, run, "approve")
    assert months(report(client, grace)) == [
        ("2026-09-01", 2, 0, 1, [("EUR", 500000, 1)])
    ]


@pytest.mark.parametrize("window", [0, 121])
def test_a_window_is_a_month_to_ten_years(client, people, window):  # noqa: F811
    response = client.get(
        f"/finance/reports/payroll?months={window}", headers=people["grace"]["headers"]
    )
    assert response.status_code == 422
