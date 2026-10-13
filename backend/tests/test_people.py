"""The people directory (#125): every active account, for anyone signed in."""

import pytest
from sqlalchemy import event

from lib_identity import people as people_service
from lib_softtrack.tables import Department, User


@pytest.fixture
def org(client, auth):
    """A small organisation: two departments, a manager and her reports.

    Registered through the API, so the first account is the site admin who
    sets the rest up.
    """
    admin = auth(email="sofia@northwind.dev", full_name="Sofia Marquez")
    people = {
        "amina": auth(email="amina@northwind.dev", full_name="Amina Khan"),
        "daniel": auth(email="daniel@northwind.dev", full_name="Daniel Okafor"),
        "kenji": auth(email="kenji@northwind.dev", full_name="Kenji Watanabe"),
        "grace": auth(email="grace@northwind.dev", full_name="grace Mensah"),
    }
    titles = {
        "amina": "Engineering Manager",
        "daniel": "Senior Backend Engineer",
        "kenji": "Staff Engineer",
        "grace": "Head of Finance",
    }
    for name, person in people.items():
        client.patch(
            "/auth/me", json={"job_title": titles[name]}, headers=person["headers"]
        )

    def department(name):
        return client.post(
            "/departments", json={"name": name}, headers=admin["headers"]
        ).json()["id"]

    engineering, finance = department("Engineering"), department("Finance")

    def place(name, **fields):
        response = client.patch(
            f"/admin/users/{people[name]['user']['id']}",
            json=fields,
            headers=admin["headers"],
        )
        assert response.status_code == 200, response.text

    place("amina", department_id=engineering)
    place("daniel", department_id=engineering, manager_id=people["amina"]["user"]["id"])
    place("kenji", department_id=engineering, manager_id=people["amina"]["user"]["id"])
    place("grace", department_id=finance)
    return {
        "admin": admin,
        **people,
        "engineering": engineering,
        "finance": finance,
    }


def _names(response):
    assert response.status_code == 200, response.text
    return [row["full_name"] for row in response.json()["items"]]


def test_anyone_signed_in_browses_everyone_by_name(client, org):
    # Daniel is nobody's admin and shares no team with anyone here.
    response = client.get("/users", headers=org["daniel"]["headers"])
    assert _names(response) == [
        "Amina Khan",
        "Daniel Okafor",
        "grace Mensah",
        "Kenji Watanabe",
        "Sofia Marquez",
    ]
    assert response.json()["total"] == 5


def test_signed_out_nobody_does(client):
    assert client.get("/users").status_code == 401


def test_a_row_says_who_they_are_and_where_they_sit_but_not_their_email(client, org):
    items = client.get(
        "/users", params={"q": "daniel"}, headers=org["kenji"]["headers"]
    ).json()["items"]
    [daniel] = items
    assert "email" not in daniel
    assert daniel["job_title"] == "Senior Backend Engineer"
    assert daniel["department"] == {"id": org["engineering"], "name": "Engineering"}
    assert daniel["manager"]["username"] == "amina"
    assert daniel["manager"]["full_name"] == "Amina Khan"


def test_deactivated_accounts_are_not_listed(client, org):
    client.patch(
        f"/admin/users/{org['kenji']['user']['id']}",
        json={"is_active": False},
        headers=org["admin"]["headers"],
    )
    names = _names(client.get("/users", headers=org["daniel"]["headers"]))
    assert "Kenji Watanabe" not in names


@pytest.mark.parametrize(
    "q, expected",
    [
        ("okafor", ["Daniel Okafor"]),  # a name, any case
        ("KENJI", ["Kenji Watanabe"]),  # a username
        ("engineer", ["Amina Khan", "Daniel Okafor", "Kenji Watanabe"]),  # a title
        ("paris", []),
    ],
)
def test_search_covers_name_username_and_title(client, org, q, expected):
    response = client.get("/users", params={"q": q}, headers=org["daniel"]["headers"])
    assert _names(response) == expected


def test_department_and_manager_filters_compose_with_search(client, org):
    headers = org["grace"]["headers"]
    in_engineering = client.get(
        "/users", params={"department_id": org["engineering"]}, headers=headers
    )
    assert _names(in_engineering) == ["Amina Khan", "Daniel Okafor", "Kenji Watanabe"]

    under_amina = client.get(
        "/users",
        params={"department_id": org["engineering"], "manager": "amina"},
        headers=headers,
    )
    assert _names(under_amina) == ["Daniel Okafor", "Kenji Watanabe"]
    # The manager the list is about comes back resolved, for the filter chip.
    assert under_amina.json()["manager"]["full_name"] == "Amina Khan"

    narrowed = client.get(
        "/users",
        params={
            "department_id": org["engineering"],
            "manager": "AMINA",
            "q": "staff",
        },
        headers=headers,
    )
    assert _names(narrowed) == ["Kenji Watanabe"]

    elsewhere = client.get(
        "/users",
        params={"department_id": org["finance"], "manager": "amina"},
        headers=headers,
    )
    assert _names(elsewhere) == []
    # Still says whose reports were asked for, though none are in Finance.
    assert elsewhere.json()["manager"]["username"] == "amina"


def test_a_manager_who_does_not_exist_matches_nobody(client, org):
    response = client.get(
        "/users", params={"manager": "nobody-here"}, headers=org["daniel"]["headers"]
    )
    assert response.json() == {
        "items": [],
        "total": 0,
        "limit": 50,
        "offset": 0,
        "manager": None,
    }


def test_the_database_pages_it(client, org):
    page = client.get(
        "/users",
        params={"limit": 2, "offset": 1},
        headers=org["daniel"]["headers"],
    ).json()
    assert page["total"] == 5
    assert [row["full_name"] for row in page["items"]] == [
        "Daniel Okafor",
        "grace Mensah",
    ]


def test_a_longer_page_costs_no_more_queries(session):
    def queries_for(count):
        department = Department(name=f"D{count}", name_key=f"d{count}")
        session.add(department)
        session.commit()
        for k in range(count):
            manager = User(
                email=f"m{count}-{k}@softtrack.dev",
                username=f"m{count}-{k}",
                hashed_password="x",
                full_name=f"Manager {count}-{k}",
            )
            session.add(manager)
            session.commit()
            session.add(
                User(
                    email=f"p{count}-{k}@softtrack.dev",
                    username=f"p{count}-{k}",
                    hashed_password="x",
                    full_name=f"Person {count}-{k}",
                    department_id=department.id,
                    manager_id=manager.id,
                )
            )
        session.commit()
        session.expire_all()

        statements = []

        def record(*_args):
            statements.append(1)

        engine = session.get_bind()
        event.listen(engine, "before_cursor_execute", record)
        try:
            page = people_service.list_people(session, q=f"person {count}-")
        finally:
            event.remove(engine, "before_cursor_execute", record)
        assert len(page.items) == count
        assert all(row.manager and row.department for row in page.items)
        return len(statements)

    assert queries_for(3) == queries_for(12)
