"""Reimbursements (#137): approved claims paid back, exactly once, visibly."""

from datetime import date, timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from lib_softtrack.tables import Expense, PayrollRun, PaySchedule, ReimbursementBatch
from tests.test_compensation import people, record  # noqa: F401 -- fixture
from tests.test_expenses import decide, submit
from tests.test_payroll import act, create

SPENT = (date.today() - timedelta(days=5)).isoformat()


@pytest.fixture
def owed(client, people):  # noqa: F811 -- the imported fixture
    """Three approved claims -- Daniel's two, in euros and dollars, and
    Amina's -- one still waiting, and one refused. Daniel and Amina are paid
    monthly; Ben is paid nothing yet."""
    grace = people["grace"]
    record(client, grace, "daniel", amount_minor=795000, effective_on=date(2024, 1, 1))
    record(
        client,
        grace,
        "amina",
        amount_minor=645000,
        currency="GBP",
        effective_on=date(2024, 1, 1),
    )
    claims = {
        "hotel": submit(client, people["daniel"], incurred_on=SPENT),
        "taxi": submit(
            client,
            people["daniel"],
            amount_minor=8600,
            currency="USD",
            description="Taxi to the data centre",
            incurred_on=SPENT,
        ),
        "monitor": submit(
            client,
            people["amina"],
            amount_minor=124900,
            description="Monitor",
            incurred_on=SPENT,
        ),
        "waiting": submit(
            client, people["ben"], amount_minor=1850, description="Parking"
        ),
        "refused": submit(
            client, people["ben"], amount_minor=14900, description="Headphones"
        ),
    }
    for name in ("hotel", "taxi", "monitor"):
        decide(client, grace, claims[name], "approve")
    decide(client, grace, claims["refused"], "refuse", reason="IT allowance")
    return {**people, "claims": claims}


def call(client, actor, method, path, status=200, **kwargs):
    response = client.request(method, path, headers=actor["headers"], **kwargs)
    assert response.status_code == status, response.text
    return response.json() if response.content and status != 204 else None


def batch_of(client, owed, *names, status=200):
    ids = [owed["claims"][name]["id"] for name in names]
    return call(
        client,
        owed["grace"],
        "POST",
        "/finance/reimbursements/batches",
        status=status,
        json={"expense_ids": ids},
    )


def awaiting(client, owed):
    return call(client, owed["grace"], "GET", "/finance/reimbursements/awaiting")


def test_reimbursement_is_finance_only(client, owed):
    batch = batch_of(client, owed, "hotel")
    for someone in (owed["sofia"], owed["daniel"]):
        for method, path in (
            ("GET", "/finance/reimbursements/awaiting"),
            ("GET", "/finance/reimbursements/batches"),
            ("GET", f"/finance/reimbursements/batches/{batch['id']}"),
            ("POST", f"/finance/reimbursements/batches/{batch['id']}/approve"),
        ):
            response = client.request(method, path, headers=someone["headers"])
            assert response.status_code == 403, path
            assert response.json()["code"] == "not_finance_admin"


def test_awaiting_is_every_approved_claim_not_yet_paid_back(client, owed):
    rows = awaiting(client, owed)
    assert [row["description"] for row in rows] == [
        "Hotel, client workshop in Lisbon",
        "Taxi to the data centre",
        "Monitor",
    ]
    assert all(row["settlement"] is None for row in rows)


def test_a_batch_pays_back_per_person_per_currency(client, owed):
    batch = batch_of(client, owed, "hotel", "taxi", "monitor")

    assert batch["label"] == f"RB-{batch['id']}"
    assert batch["state"] == "draft"
    assert [
        (
            line["person"]["username"],
            line["currency"],
            line["amount_minor"],
            line["claims"],
        )
        for line in batch["lines"]
    ] == [
        ("amina", "EUR", 124900, 1),
        ("daniel", "EUR", 41240, 1),
        ("daniel", "USD", 8600, 1),
    ]
    assert [
        (t["currency"], t["amount_minor"], t["claims"]) for t in batch["totals"]
    ] == [
        ("EUR", 166140, 2),
        ("USD", 8600, 1),
    ]
    assert (batch["claim_count"], batch["people_count"]) == (3, 2)

    # Every claim now says where it is going, and nobody gathers it again.
    settlement = awaiting(client, owed)[0]["settlement"]
    assert (settlement["kind"], settlement["id"], settlement["state"]) == (
        "batch",
        batch["id"],
        "draft",
    )


def test_a_claim_is_gathered_once(client, owed):
    first = batch_of(client, owed, "hotel")

    twice = batch_of(client, owed, "hotel", "taxi", status=409)
    assert twice["code"] == "expense_already_settled"
    assert twice["detail"] == (
        f"“Hotel, client workshop in Lisbon” is already in RB-{first['id']}. "
        "A claim is paid back once"
    )
    assert (
        batch_of(client, owed, "waiting", status=409)["code"] == "expense_not_approved"
    )
    assert (
        batch_of(client, owed, "refused", status=409)["code"] == "expense_not_approved"
    )
    unknown = call(
        client,
        owed["grace"],
        "POST",
        "/finance/reimbursements/batches",
        status=404,
        json={"expense_ids": [999]},
    )
    assert unknown["code"] == "expense_not_found"


def test_paid_back_exactly_once_is_the_rows_own_rule(session, owed):
    """Not only the service's: the database will not record it either."""
    hotel = session.get(Expense, owed["claims"]["hotel"]["id"])
    run = PayrollRun(
        pay_schedule=PaySchedule.monthly,
        period_start=date(2026, 9, 1),
        period_end=date(2026, 9, 30),
        created_by_id=owed["grace"]["user"]["id"],
    )
    batch = ReimbursementBatch(created_by_id=owed["grace"]["user"]["id"])
    session.add_all([run, batch])
    session.commit()

    hotel.reimbursement_batch_id = batch.id
    hotel.payroll_run_id = run.id
    session.add(hotel)
    with pytest.raises(IntegrityError, match="ck_expense_settled_once"):
        session.commit()
    session.rollback()

    waiting = session.get(Expense, owed["claims"]["waiting"]["id"])
    waiting.reimbursement_batch_id = batch.id
    session.add(waiting)
    with pytest.raises(IntegrityError, match="ck_expense_settles_approved"):
        session.commit()
    session.rollback()


def test_a_claim_comes_back_out_of_a_draft_and_an_emptied_batch_goes(client, owed):
    grace = owed["grace"]
    batch = batch_of(client, owed, "hotel")

    released = call(
        client,
        grace,
        "DELETE",
        f"/finance/reimbursements/expenses/{owed['claims']['hotel']['id']}/settlement",
    )
    assert released["settlement"] is None
    gone = client.get(
        f"/finance/reimbursements/batches/{batch['id']}", headers=grace["headers"]
    )
    assert gone.status_code == 404
    assert gone.json()["code"] == "reimbursement_batch_not_found"


def test_an_approved_batch_is_exported_paid_and_seen(client, owed):
    grace, daniel = owed["grace"], owed["daniel"]
    batch = batch_of(client, owed, "hotel", "taxi", "monitor")
    path = f"/finance/reimbursements/batches/{batch['id']}"

    early = client.get(f"{path}/export", headers=grace["headers"])
    assert early.status_code == 409
    assert early.json()["code"] == "reimbursement_batch_not_approved"

    approved = call(client, grace, "POST", f"{path}/approve")
    assert approved["approved_by"]["username"] == "grace"
    locked = call(
        client,
        grace,
        "DELETE",
        f"/finance/reimbursements/expenses/{owed['claims']['hotel']['id']}/settlement",
        status=409,
    )
    assert locked["code"] == "expense_settlement_locked"
    assert call(client, grace, "DELETE", path, status=409)["code"] == (
        "reimbursement_batch_not_draft"
    )

    export = client.get(f"{path}/export", headers=grace["headers"])
    assert export.status_code == 200
    assert export.headers["content-disposition"] == (
        f'attachment; filename="reimbursements-rb-{batch["id"]}.csv"'
    )
    assert export.content.decode("utf-8-sig").split("\r\n") == [
        "name,amount,currency,period_start,period_end,kind",
        f"Amina Khan,1249.00,EUR,{SPENT},{SPENT},reimbursement",
        f"Daniel Okafor,412.40,EUR,{SPENT},{SPENT},reimbursement",
        f"Daniel Okafor,86.00,USD,{SPENT},{SPENT},reimbursement",
        "",
    ]

    # Before it is paid, the submitter sees it on its way.
    before = call(client, daniel, "GET", "/expenses")["items"]
    assert {row["settlement"]["state"] for row in before} == {"approved"}
    assert {row["reimbursed_at"] for row in before} == {None}

    paid = call(client, grace, "POST", f"{path}/paid")
    assert paid["state"] == "paid"
    after = call(client, daniel, "GET", "/expenses")["items"]
    assert {row["reimbursed_at"] is not None for row in after} == {True}
    assert after[0]["settlement"]["paid_by"]["username"] == "grace"
    assert awaiting(client, owed) == []


def test_a_payroll_run_carries_claims_as_lines_of_their_own(client, owed):
    grace = owed["grace"]
    run = create(client, grace)
    ids = [owed["claims"][name]["id"] for name in ("hotel", "taxi")]

    carried = call(
        client,
        grace,
        "POST",
        "/finance/reimbursements/carry",
        json={"run_id": run["id"], "expense_ids": ids},
    )
    assert [
        (
            line["person"]["username"],
            line["currency"],
            line["amount_minor"],
            line["claims"],
        )
        for line in carried["reimbursements"]
    ] == [("daniel", "EUR", 41240, 1), ("daniel", "USD", 8600, 1)]
    # Never folded into the pay.
    daniel = next(l for l in carried["lines"] if l["person"]["username"] == "daniel")
    assert daniel["total_minor"] == 795000
    assert [
        (t["currency"], t["amount_minor"]) for t in carried["reimbursement_totals"]
    ] == [
        ("EUR", 41240),
        ("USD", 8600),
    ]
    listed = call(client, grace, "GET", "/finance/payroll/runs")["items"][0]
    assert [t["amount_minor"] for t in listed["reimbursement_totals"]] == [41240, 8600]

    act(client, grace, run, "approve")
    export = client.get(
        f"/finance/payroll/runs/{run['id']}/export", headers=grace["headers"]
    ).content.decode("utf-8-sig")
    assert export.split("\r\n")[1:] == [
        "Amina Khan,6450.00,GBP,2026-09-01,2026-09-30,wages",
        "Daniel Okafor,7950.00,USD,2026-09-01,2026-09-30,wages",
        "Daniel Okafor,412.40,EUR,2026-09-01,2026-09-30,reimbursement",
        "Daniel Okafor,86.00,USD,2026-09-01,2026-09-30,reimbursement",
        "",
    ]

    act(client, grace, run, "paid")
    mine = call(client, owed["daniel"], "GET", "/expenses")["items"]
    assert {row["settlement"]["kind"] for row in mine} == {"payroll_run"}
    assert {row["settlement"]["period_start"] for row in mine} == {"2026-09-01"}
    assert all(row["reimbursed_at"] for row in mine)


def test_a_run_carries_claims_only_for_people_it_pays(client, owed):
    grace = owed["grace"]
    run = create(client, grace, pay_schedule="semi_monthly", period_end="2026-09-15")
    refused = call(
        client,
        grace,
        "POST",
        "/finance/reimbursements/carry",
        status=409,
        json={"run_id": run["id"], "expense_ids": [owed["claims"]["monitor"]["id"]]},
    )
    assert refused["code"] == "reimbursement_not_on_run"
    assert refused["detail"].startswith("This run does not pay Amina Khan")


def test_throwing_a_draft_run_away_releases_what_it_carried(client, owed):
    grace = owed["grace"]
    run = create(client, grace)
    call(
        client,
        grace,
        "POST",
        "/finance/reimbursements/carry",
        json={"run_id": run["id"], "expense_ids": [owed["claims"]["hotel"]["id"]]},
    )
    assert (
        client.delete(
            f"/finance/payroll/runs/{run['id']}", headers=grace["headers"]
        ).status_code
        == 204
    )
    assert awaiting(client, owed)[0]["settlement"] is None


def test_the_batches_list_is_newest_first_with_totals(client, owed):
    grace = owed["grace"]
    first = batch_of(client, owed, "hotel")
    second = batch_of(client, owed, "taxi", "monitor")
    page = call(client, grace, "GET", "/finance/reimbursements/batches")
    assert [item["id"] for item in page["items"]] == [second["id"], first["id"]]
    assert page["items"][0]["people_count"] == 2
    assert [t["amount_minor"] for t in page["items"][0]["totals"]] == [124900, 8600]
