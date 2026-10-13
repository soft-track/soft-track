"""Expense claims (#133): your own claims, and finance's decision on them."""

import io
from datetime import date, timedelta

import pytest

from tests.test_compensation import people  # noqa: F401 -- fixture
from tests.test_guest_role import PNG

PDF = b"%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n"
TODAY = date.today()


def submit(client, actor, status=200, **body):
    response = client.post(
        "/expenses",
        json={
            "amount_minor": 41240,
            "currency": "EUR",
            "incurred_on": (TODAY - timedelta(days=3)).isoformat(),
            "description": "Hotel, client workshop in Lisbon",
            **body,
        },
        headers=actor["headers"],
    )
    assert response.status_code == status, response.text
    return response.json()


def upload(client, actor, claim, name="receipt.png", data=PNG, status=200):
    response = client.put(
        f"/expenses/{claim['id']}/receipt",
        files={"file": (name, io.BytesIO(data), "application/octet-stream")},
        headers=actor["headers"],
    )
    assert response.status_code == status, response.text
    return response.json()


def decide(client, actor, claim, verb, status=200, **body):
    response = client.post(
        f"/finance/expenses/{claim['id']}/{verb}",
        json=body or None,
        headers=actor["headers"],
    )
    assert response.status_code == status, response.text
    return response.json()


def queue(client, actor, query=""):
    response = client.get(f"/finance/expenses{query}", headers=actor["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def test_a_claim_is_its_submitters_and_nobody_elses(client, people):
    daniel, amina = people["daniel"], people["amina"]
    claim = submit(client, daniel)
    assert claim["state"] == "submitted"
    assert claim["receipt"] is None

    mine = client.get("/expenses", headers=daniel["headers"]).json()
    assert [row["id"] for row in mine["items"]] == [claim["id"]]
    assert client.get("/expenses", headers=amina["headers"]).json()["items"] == []

    # Somebody else's claim does not exist, as far as they can tell.
    for response in (
        client.patch(
            f"/expenses/{claim['id']}",
            json={"description": "mine now"},
            headers=amina["headers"],
        ),
        client.delete(f"/expenses/{claim['id']}", headers=amina["headers"]),
        client.get(f"/expenses/{claim['id']}/receipt", headers=amina["headers"]),
    ):
        assert response.status_code == 404
        assert response.json()["code"] == "expense_not_found"


def test_the_queue_is_finance_only_not_even_the_site_admin(client, people):
    claim = submit(client, people["daniel"])
    for someone in (people["sofia"], people["amina"]):
        for response in (
            client.get("/finance/expenses", headers=someone["headers"]),
            client.get(f"/finance/expenses/{claim['id']}", headers=someone["headers"]),
            client.post(
                f"/finance/expenses/{claim['id']}/approve", headers=someone["headers"]
            ),
        ):
            assert response.status_code == 403
            assert response.json()["code"] == "not_finance_admin"


@pytest.mark.parametrize(
    "field, value",
    [
        ("amount_minor", 0),
        ("amount_minor", -5),
        ("currency", "XYZ"),
        ("description", "   "),
        ("description", "x" * 201),
    ],
)
def test_a_claim_is_a_positive_amount_in_a_known_currency_for_something(
    client, people, field, value
):
    submit(client, people["daniel"], status=422, **{field: value})


def test_a_claim_is_for_money_already_spent(client, people):
    daniel = people["daniel"]
    # A day ahead is somebody in a timezone ahead of the server.
    submit(client, daniel, incurred_on=(TODAY + timedelta(days=1)).isoformat())
    later = submit(
        client, daniel, status=400, incurred_on=(TODAY + timedelta(days=3)).isoformat()
    )
    assert later["code"] == "expense_in_future"


def test_a_waiting_claim_can_change_and_a_decided_one_cannot(client, people):
    daniel, grace = people["daniel"], people["grace"]
    claim = submit(client, daniel)

    changed = client.patch(
        f"/expenses/{claim['id']}",
        json={"amount_minor": 41300, "description": "  Hotel, Lisbon  "},
        headers=daniel["headers"],
    ).json()
    assert (changed["amount_minor"], changed["description"]) == (41300, "Hotel, Lisbon")
    assert changed["currency"] == "EUR"

    decide(client, grace, claim, "approve")
    for response in (
        client.patch(
            f"/expenses/{claim['id']}",
            json={"amount_minor": 1},
            headers=daniel["headers"],
        ),
        client.delete(f"/expenses/{claim['id']}", headers=daniel["headers"]),
        client.put(
            f"/expenses/{claim['id']}/receipt",
            files={"file": ("r.png", io.BytesIO(PNG), "image/png")},
            headers=daniel["headers"],
        ),
    ):
        assert response.status_code == 409
        assert response.json()["code"] == "expense_decided"


def test_the_receipt_rides_the_attachment_pipeline(client, people, storage):
    daniel = people["daniel"]
    claim = submit(client, daniel)

    with_png = upload(client, daniel, claim)
    url = with_png["receipt"].pop("url")
    assert with_png["receipt"] == {
        "filename": "receipt.png",
        "content_type": "image/png",
        "size_bytes": len(PNG),
        "is_image": True,
    }
    assert url.startswith(f"/expenses/{claim['id']}/receipt?v=")

    # Replacing it takes the old bytes away.
    first_key = next(storage.root.rglob("*.png"))
    with_pdf = upload(client, daniel, claim, name="hotel-alfama.pdf", data=PDF)
    assert with_pdf["receipt"]["content_type"] == "application/pdf"
    assert with_pdf["receipt"]["is_image"] is False
    # A new file, a new address: nothing cached the PNG under it.
    assert with_pdf["receipt"]["url"] != url
    assert not first_key.exists()

    response = client.get(f"/expenses/{claim['id']}/receipt", headers=daniel["headers"])
    assert response.status_code == 200
    assert response.content == PDF
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"].startswith("inline;")
    assert response.headers["x-content-type-options"] == "nosniff"

    # Only what a receipt can be, and only what it says it is.
    refused = upload(
        client, daniel, claim, name="receipts.zip", data=b"PK\x03\x04", status=415
    )
    assert refused["code"] == "attachment_type_not_allowed"
    assert ".txt" not in refused["detail"]
    fake = upload(
        client, daniel, claim, name="receipt.png", data=b"not a png", status=422
    )
    assert fake["code"] == "attachment_content_mismatch"

    removed = client.delete(
        f"/expenses/{claim['id']}/receipt", headers=daniel["headers"]
    ).json()
    assert removed["receipt"] is None
    assert list(storage.root.rglob("*.pdf")) == []
    gone = client.get(f"/expenses/{claim['id']}/receipt", headers=daniel["headers"])
    assert gone.status_code == 404
    assert gone.json()["code"] == "receipt_not_found"


def test_withdrawing_takes_the_claim_and_its_receipt(client, people, storage):
    daniel = people["daniel"]
    claim = submit(client, daniel)
    upload(client, daniel, claim)

    response = client.delete(f"/expenses/{claim['id']}", headers=daniel["headers"])
    assert response.status_code == 204
    assert client.get("/expenses", headers=daniel["headers"]).json()["total"] == 0
    assert list(storage.root.rglob("*.png")) == []


def test_finance_sees_every_claim_filtered_and_counted(client, people):
    grace, daniel, amina = people["grace"], people["daniel"], people["amina"]
    hotel = submit(client, daniel)
    taxi = submit(client, daniel, amount_minor=8600, currency="USD", description="Taxi")
    monitor = submit(
        client,
        amina,
        amount_minor=124900,
        description="Monitor",
        incurred_on=(TODAY - timedelta(days=9)).isoformat(),
    )
    decide(client, grace, taxi, "refuse", reason="Personal travel")

    everything = queue(client, grace)
    assert [row["id"] for row in everything["items"]] == [
        taxi["id"],
        hotel["id"],
        monitor["id"],
    ]
    assert everything["counts"] == {"submitted": 2, "approved": 0, "refused": 1}
    assert everything["items"][0]["submitter"]["username"] == "daniel"

    waiting = queue(client, grace, "?state=submitted")
    assert [row["id"] for row in waiting["items"]] == [hotel["id"], monitor["id"]]

    daniels = queue(client, grace, f"?submitter_id={daniel['user']['id']}")
    assert daniels["total"] == 2
    assert daniels["counts"] == {"submitted": 1, "approved": 0, "refused": 1}


def test_approval_copies_the_department_and_says_who(client, people):
    grace, daniel, sofia = people["grace"], people["daniel"], people["sofia"]
    engineering = client.post(
        "/departments", json={"name": "Engineering"}, headers=sofia["headers"]
    ).json()
    client.patch(
        f"/admin/users/{daniel['user']['id']}",
        json={"department_id": engineering["id"]},
        headers=sofia["headers"],
    )
    claim = submit(client, daniel)

    approved = decide(client, grace, claim, "approve")
    assert approved["state"] == "approved"
    assert approved["decided_by"]["username"] == "grace"
    assert approved["department"]["name"] == "Engineering"

    # A reorg afterwards does not move the spend.
    client.patch(
        f"/admin/users/{daniel['user']['id']}",
        json={"department_id": None},
        headers=sofia["headers"],
    )
    again = client.get(
        f"/finance/expenses/{claim['id']}", headers=grace["headers"]
    ).json()
    assert again["department"]["name"] == "Engineering"

    # Which is also why that department stays.
    refused = client.delete(
        f"/departments/{engineering['id']}", headers=sofia["headers"]
    )
    assert refused.status_code == 409
    assert refused.json()["code"] == "department_has_finance_history"

    mine = client.get("/expenses", headers=daniel["headers"]).json()["items"][0]
    assert mine["state"] == "approved"
    assert mine["decided_by"]["username"] == "grace"
    assert decide(client, grace, claim, "refuse", status=409, reason="x")["code"] == (
        "expense_decided"
    )


def test_a_refusal_says_why_and_the_submitter_sees_it(client, people):
    grace, amina = people["grace"], people["amina"]
    claim = submit(client, amina, amount_minor=14900, description="Headphones")

    decide(client, grace, claim, "refuse", status=422, reason="   ")
    decide(client, grace, claim, "refuse", status=422)

    refused = decide(
        client,
        grace,
        claim,
        "refuse",
        reason="  Headphones come from the IT allowance, not expenses.  ",
    )
    assert refused["state"] == "refused"
    mine = client.get("/expenses", headers=amina["headers"]).json()["items"][0]
    assert (
        mine["refusal_reason"] == "Headphones come from the IT allowance, not expenses."
    )
    assert mine["decided_by"]["full_name"] == "Grace Mensah"


def test_nobody_decides_their_own_claim(client, people):
    grace = people["grace"]
    claim = submit(client, grace)
    for verb, body in (("approve", {}), ("refuse", {"reason": "no"})):
        own = decide(client, grace, claim, verb, status=409, **body)
        assert own["code"] == "expense_own_claim"


def test_finance_reads_the_receipt_on_its_own_route(client, people):
    grace, daniel = people["grace"], people["daniel"]
    claim = submit(client, daniel)
    upload(client, daniel, claim)

    row = client.get(
        f"/finance/expenses/{claim['id']}", headers=grace["headers"]
    ).json()
    assert row["receipt"]["url"].startswith(
        f"/finance/expenses/{claim['id']}/receipt?v="
    )
    response = client.get(row["receipt"]["url"], headers=grace["headers"])
    assert response.status_code == 200
    assert response.content == PNG
    # And not on somebody else's personal route.
    assert (
        client.get(
            f"/expenses/{claim['id']}/receipt", headers=grace["headers"]
        ).status_code
        == 404
    )
