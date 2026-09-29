"""Compensation (#131): an effective-dated history of pay, readable by finance only."""

from datetime import date, timedelta

import pytest

from lib_finance import compensation

TODAY = date.today()
LAST_YEAR = TODAY - timedelta(days=365)
LAST_MONTH = TODAY - timedelta(days=30)
NEXT_MONTH = TODAY + timedelta(days=30)


@pytest.fixture
def people(client, auth):
    """Sofia runs the instance, Grace has finance access, and three others."""
    sofia = auth(email="sofia@northwind.dev", full_name="Sofia Marquez")
    grace = auth(email="grace@northwind.dev", full_name="Grace Mensah")
    everyone = {
        "sofia": sofia,
        "grace": grace,
        **{
            name: auth(email=f"{name}@northwind.dev", full_name=full)
            for name, full in [
                ("amina", "Amina Khan"),
                ("daniel", "Daniel Okafor"),
                ("ben", "Ben Adeyemi"),
            ]
        },
    }
    response = client.patch(
        f"/admin/users/{grace['user']['id']}",
        json={"is_finance_admin": True},
        headers=sofia["headers"],
    )
    assert response.status_code == 200, response.text
    return everyone


def record(client, actor, username, status=200, **body):
    payload = {
        "amount_minor": 725000,
        "currency": "USD",
        "pay_schedule": "monthly",
        "effective_on": LAST_YEAR.isoformat(),
        "kind": "hire",
        **body,
    }
    for key in ("effective_on",):
        if isinstance(payload[key], date):
            payload[key] = payload[key].isoformat()
    response = client.post(
        f"/finance/compensation/{username}", json=payload, headers=actor["headers"]
    )
    assert response.status_code == status, response.text
    return response.json()


def listing(client, actor, query=""):
    response = client.get(f"/finance/compensation{query}", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def row(page, username):
    return next(
        item for item in page["items"] if item["person"]["username"] == username
    )


def history(client, actor, username):
    response = client.get(f"/finance/compensation/{username}", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()["records"]


def test_nobody_else_sees_pay_not_even_the_site_admin(client, people):
    grace, daniel = people["grace"], people["daniel"]
    record(client, grace, "daniel")

    for someone in (people["sofia"], daniel):
        for response in (
            client.get("/finance/compensation", headers=someone["headers"]),
            client.get("/finance/compensation/daniel", headers=someone["headers"]),
            client.post(
                "/finance/compensation/daniel",
                json={
                    "amount_minor": 1,
                    "currency": "USD",
                    "pay_schedule": "monthly",
                    "effective_on": "2026-01-01",
                    "kind": "raise",
                },
                headers=someone["headers"],
            ),
        ):
            assert response.status_code == 403
            assert response.json()["code"] == "not_finance_admin"


def test_recording_pay_makes_it_what_they_are_paid(client, people):
    grace = people["grace"]
    created = record(client, grace, "daniel", note="  Offer letter  ")

    assert created["standing"] == "current"
    assert created["note"] == "Offer letter"
    assert created["recorded_by"]["username"] == "grace"

    daniel = row(listing(client, grace), "daniel")
    assert daniel["current"]["amount_minor"] == 725000
    assert daniel["current"]["currency"] == "USD"
    assert daniel["current"]["pay_schedule"] == "monthly"
    assert daniel["current"]["effective_on"] == LAST_YEAR.isoformat()
    assert daniel["change_percent"] is None
    assert daniel["scheduled"] == []


def test_a_raise_is_a_new_record_and_the_old_one_stays(client, people):
    grace = people["grace"]
    record(client, grace, "daniel", amount_minor=725000)
    record(
        client,
        grace,
        "daniel",
        amount_minor=759000,
        kind="raise",
        effective_on=LAST_MONTH,
    )

    daniel = row(listing(client, grace), "daniel")
    assert daniel["current"]["amount_minor"] == 759000
    assert daniel["current"]["kind"] == "raise"
    assert daniel["change_percent"] == 4.7

    assert [
        (r["amount_minor"], r["standing"]) for r in history(client, grace, "daniel")
    ] == [
        (759000, "current"),
        (725000, "past"),
    ]


def test_a_future_record_is_scheduled_until_its_day(client, people):
    grace = people["grace"]
    record(client, grace, "daniel", amount_minor=725000)
    record(
        client,
        grace,
        "daniel",
        amount_minor=830000,
        kind="raise",
        effective_on=NEXT_MONTH,
    )

    daniel = row(listing(client, grace), "daniel")
    assert daniel["current"]["amount_minor"] == 725000
    assert [r["amount_minor"] for r in daniel["scheduled"]] == [830000]
    assert daniel["scheduled"][0]["standing"] == "scheduled"


def test_a_correction_replaces_the_record_it_names(client, people):
    grace = people["grace"]
    record(client, grace, "daniel", amount_minor=725000)
    typo = record(
        client,
        grace,
        "daniel",
        amount_minor=759000,
        kind="raise",
        effective_on=LAST_MONTH,
    )
    fixed = record(
        client,
        grace,
        "daniel",
        amount_minor=795000,
        kind="correction",
        effective_on=LAST_MONTH,
        corrects_id=typo["id"],
        note="typo in the raise letter",
    )

    assert fixed["standing"] == "current"
    assert fixed["corrects_id"] == typo["id"]
    records = history(client, grace, "daniel")
    # The correction sits above what it corrects.
    assert [(r["amount_minor"], r["standing"]) for r in records] == [
        (795000, "current"),
        (759000, "corrected"),
        (725000, "past"),
    ]
    assert records[1]["corrected_by_id"] == fixed["id"]

    daniel = row(listing(client, grace), "daniel")
    assert daniel["current"]["id"] == fixed["id"]
    # Against the hire: the corrected raise never happened.
    assert daniel["change_percent"] == 9.7


def test_a_correction_can_move_the_date_too(client, people):
    grace = people["grace"]
    record(client, grace, "daniel", amount_minor=725000)
    early = record(
        client,
        grace,
        "daniel",
        amount_minor=759000,
        kind="raise",
        effective_on=LAST_MONTH,
    )
    record(
        client,
        grace,
        "daniel",
        amount_minor=759000,
        kind="correction",
        effective_on=NEXT_MONTH,
        corrects_id=early["id"],
    )

    daniel = row(listing(client, grace), "daniel")
    assert daniel["current"]["amount_minor"] == 725000
    assert [r["effective_on"] for r in daniel["scheduled"]] == [NEXT_MONTH.isoformat()]


def test_a_record_is_corrected_once_and_then_the_correction_is(client, people):
    grace = people["grace"]
    first = record(client, grace, "daniel")
    fix = record(
        client,
        grace,
        "daniel",
        kind="correction",
        corrects_id=first["id"],
        amount_minor=730000,
    )

    refused = client.post(
        "/finance/compensation/daniel",
        json={
            "amount_minor": 740000,
            "currency": "USD",
            "pay_schedule": "monthly",
            "effective_on": LAST_YEAR.isoformat(),
            "kind": "correction",
            "corrects_id": first["id"],
        },
        headers=grace["headers"],
    )
    assert refused.status_code == 409
    assert refused.json()["code"] == "compensation_already_corrected"

    record(
        client,
        grace,
        "daniel",
        kind="correction",
        corrects_id=fix["id"],
        amount_minor=740000,
    )
    assert row(listing(client, grace), "daniel")["current"]["amount_minor"] == 740000


def test_a_correction_names_one_of_their_own_records(client, people):
    grace = people["grace"]
    amina = record(client, grace, "amina")

    elsewhere = client.post(
        "/finance/compensation/daniel",
        json={
            "amount_minor": 1,
            "currency": "USD",
            "pay_schedule": "monthly",
            "effective_on": "2026-01-01",
            "kind": "correction",
            "corrects_id": amina["id"],
        },
        headers=grace["headers"],
    )
    assert elsewhere.status_code == 404
    assert elsewhere.json()["code"] == "compensation_not_found"

    # And the shape is refused before anything is looked up.
    for body in ({"kind": "correction"}, {"kind": "raise", "corrects_id": amina["id"]}):
        response = client.post(
            "/finance/compensation/amina",
            json={
                "amount_minor": 1,
                "currency": "USD",
                "pay_schedule": "monthly",
                "effective_on": "2026-01-01",
                **body,
            },
            headers=grace["headers"],
        )
        assert response.status_code == 422, body


@pytest.mark.parametrize(
    "field, value",
    [
        ("amount_minor", 0),
        ("amount_minor", -100),
        ("amount_minor", 12.5),
        ("amount_minor", 10**13),
        ("currency", "XYZ"),
        ("currency", "usd"),
        ("pay_schedule", "weekly"),
        ("kind", "bonus"),
    ],
)
def test_pay_is_whole_positive_minor_units_in_a_known_currency(
    client, people, field, value
):
    record(client, people["grace"], "daniel", status=422, **{field: value})


def test_nobody_new_is_found_by_an_unknown_name(client, people):
    grace = people["grace"]
    assert (
        client.get("/finance/compensation/nobody", headers=grace["headers"]).status_code
        == 404
    )
    record(client, grace, "nobody", status=404)


def test_people_with_nothing_in_effect_come_last_and_are_counted(client, people):
    grace = people["grace"]
    record(client, grace, "daniel")
    record(client, grace, "amina", effective_on=NEXT_MONTH)

    page = listing(client, grace)
    usernames = [item["person"]["username"] for item in page["items"]]
    # Paid first, then everyone else -- each by name.
    assert usernames == ["daniel", "amina", "ben", "grace", "sofia"]
    assert page["missing"] == 4
    starting = row(page, "amina")
    assert starting["current"] is None
    assert [r["kind"] for r in starting["scheduled"]] == ["hire"]


def test_totals_are_per_currency_and_schedule_and_never_converted(client, people):
    grace = people["grace"]
    record(client, grace, "amina", amount_minor=645000, currency="GBP")
    record(client, grace, "daniel", amount_minor=520000, currency="EUR")
    record(client, grace, "ben", amount_minor=470000, currency="EUR")
    record(client, grace, "grace", amount_minor=310000, pay_schedule="semi_monthly")
    record(client, grace, "sofia", amount_minor=295000, pay_schedule="bi_weekly")

    assert [
        (t["pay_schedule"], t["currency"], t["amount_minor"], t["people"])
        for t in listing(client, grace)["totals"]
    ] == [
        ("monthly", "EUR", 990000, 2),
        ("monthly", "GBP", 645000, 1),
        ("semi_monthly", "USD", 310000, 1),
        ("bi_weekly", "USD", 295000, 1),
    ]


def test_filters_narrow_the_rows_and_the_totals_alike(client, people):
    grace, sofia = people["grace"], people["sofia"]
    engineering = client.post(
        "/departments", json={"name": "Engineering"}, headers=sofia["headers"]
    ).json()
    for username in ("amina", "daniel"):
        client.patch(
            f"/admin/users/{people[username]['user']['id']}",
            json={"department_id": engineering["id"]},
            headers=sofia["headers"],
        )
    record(client, grace, "amina", amount_minor=645000, currency="GBP")
    record(client, grace, "daniel", amount_minor=520000, currency="EUR")
    record(client, grace, "ben", amount_minor=470000, currency="EUR")

    in_engineering = listing(client, grace, f"?department_id={engineering['id']}")
    assert {i["person"]["username"] for i in in_engineering["items"]} == {
        "amina",
        "daniel",
    }
    assert (
        row(in_engineering, "daniel")["person"]["department"]["name"] == "Engineering"
    )
    assert {t["currency"] for t in in_engineering["totals"]} == {"GBP", "EUR"}

    in_euros = listing(client, grace, "?currency=EUR")
    assert [i["person"]["username"] for i in in_euros["items"]] == ["ben", "daniel"]
    assert [t["amount_minor"] for t in in_euros["totals"]] == [990000]
    assert in_euros["missing"] == 0

    by_name = listing(client, grace, "?q=okaf")
    assert [i["person"]["username"] for i in by_name["items"]] == ["daniel"]


def test_the_list_pages_and_keeps_its_totals_whole(client, people):
    grace = people["grace"]
    for username in ("amina", "ben", "daniel"):
        record(client, grace, username, amount_minor=100000)

    page = listing(client, grace, "?limit=2&offset=1")
    assert page["total"] == 5
    assert len(page["items"]) == 2
    assert page["totals"][0]["amount_minor"] == 300000


def test_someone_who_left_keeps_their_history_but_leaves_the_list(client, people):
    grace, sofia, ben = people["grace"], people["sofia"], people["ben"]
    record(client, grace, "ben")
    client.patch(
        f"/admin/users/{ben['user']['id']}",
        json={"is_active": False},
        headers=sofia["headers"],
    )

    assert "ben" not in {
        i["person"]["username"] for i in listing(client, grace)["items"]
    }
    assert [r["standing"] for r in history(client, grace, "ben")] == ["current"]


def test_pay_on_any_day_is_the_latest_uncorrected_record_by_then(
    session, client, people
):
    grace = people["grace"]
    record(client, grace, "daniel", amount_minor=100, effective_on=date(2024, 1, 1))
    raise_ = record(
        client,
        grace,
        "daniel",
        amount_minor=200,
        kind="raise",
        effective_on=date(2025, 1, 1),
    )
    record(
        client,
        grace,
        "daniel",
        amount_minor=250,
        kind="correction",
        effective_on=date(2025, 1, 1),
        corrects_id=raise_["id"],
    )
    record(
        client,
        grace,
        "daniel",
        amount_minor=300,
        kind="raise",
        effective_on=date(2026, 1, 1),
    )
    daniel_id = people["daniel"]["user"]["id"]

    def paid(day):
        found = compensation.pay_on(session, [daniel_id], day)
        return found[daniel_id].amount_minor if daniel_id in found else None

    assert paid(date(2023, 12, 31)) is None
    assert paid(date(2024, 6, 1)) == 100
    assert paid(date(2025, 1, 1)) == 250
    assert paid(date(2025, 12, 31)) == 250
    assert paid(date(2026, 1, 1)) == 300


def test_currencies_are_listed_with_their_decimal_places(client, people):
    response = client.get("/currencies", headers=people["ben"]["headers"])
    assert response.status_code == 200
    places = {c["code"]: c["minor_units"] for c in response.json()}
    assert (places["USD"], places["JPY"], places["KWD"]) == (2, 0, 3)
    assert client.get("/currencies").status_code == 401
