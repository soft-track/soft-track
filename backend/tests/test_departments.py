"""Departments (#123): a flat list a site admin keeps, that people belong to."""

import pytest
from sqlalchemy import event

from lib_identity import admin as admin_service
from lib_identity import departments as departments_service
from lib_identity.models.departments import DepartmentCreate
from lib_softtrack.tables import Department, User
from lib_utils.errors import ApiError


@pytest.fixture
def admin(auth):
    """The first account, and so the site admin."""
    return auth(email="admin@softtrack.dev", full_name="Site Admin")


def _create(client, actor, name, description=None):
    response = client.post(
        "/departments",
        json={"name": name, "description": description},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def _put_in(client, actor, person, department_id):
    response = client.patch(
        f"/admin/users/{person['user']['id']}",
        json={"department_id": department_id},
        headers=actor["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def _department_of(client, person):
    return client.get("/auth/me", headers=person["headers"]).json()["department"]


# --- Reading ---------------------------------------------------------------


def test_anyone_signed_in_reads_the_list_by_name(client, admin, auth):
    _create(client, admin, "engineering")
    _create(client, admin, "Design", "Product design and research")
    member = auth(email="member@softtrack.dev")

    response = client.get("/departments", headers=member["headers"])
    assert response.status_code == 200
    assert [(d["name"], d["description"]) for d in response.json()] == [
        ("Design", "Product design and research"),
        ("engineering", None),
    ]


def test_signed_out_nobody_reads_it(client):
    assert client.get("/departments").status_code == 401


def test_the_count_is_everybody_in_it_deactivated_included(client, admin, auth):
    design = _create(client, admin, "Design")
    ada = auth(email="ada@softtrack.dev")
    sam = auth(email="sam@softtrack.dev")
    _put_in(client, admin, ada, design["id"])
    _put_in(client, admin, sam, design["id"])
    client.patch(
        f"/admin/users/{sam['user']['id']}",
        json={"is_active": False},
        headers=admin["headers"],
    )

    [row] = client.get("/departments", headers=admin["headers"]).json()
    # Sam still points at it, and a delete would have to put him somewhere.
    assert row["member_count"] == 2


# --- Writing is a site admin's -----------------------------------------------


def test_only_a_site_admin_creates_renames_or_deletes(client, admin, auth):
    design = _create(client, admin, "Design")
    member = auth(email="member@softtrack.dev")

    attempts = [
        client.post("/departments", json={"name": "X"}, headers=member["headers"]),
        client.patch(
            f"/departments/{design['id']}",
            json={"name": "X"},
            headers=member["headers"],
        ),
        client.delete(f"/departments/{design['id']}", headers=member["headers"]),
    ]
    for response in attempts:
        assert response.status_code == 403
        assert response.json()["code"] == "not_site_admin"


def test_a_name_is_trimmed_and_cannot_be_blank(client, admin):
    assert _create(client, admin, "  Finance  ")["name"] == "Finance"

    blank = client.post("/departments", json={"name": "   "}, headers=admin["headers"])
    assert blank.status_code == 400
    assert blank.json()["code"] == "name_required"


def test_names_are_unique_whatever_the_case_and_the_clash_is_named(client, admin):
    _create(client, admin, "Engineering")

    response = client.post(
        "/departments", json={"name": "ENGINEERING"}, headers=admin["headers"]
    )
    assert response.status_code == 400
    assert response.json() == {
        "detail": "“Engineering” already exists. Department names are unique, "
        "whatever the case.",
        "code": "department_name_taken",
    }


def test_a_name_that_differs_only_in_a_non_ascii_letter_clashes(client, admin):
    """Folded by Python, not by SQLite's lower(), which only folds ASCII."""
    _create(client, admin, "Équipe")
    response = client.post(
        "/departments", json={"name": "équipe"}, headers=admin["headers"]
    )
    assert response.json()["code"] == "department_name_taken"


def test_renaming_follows_everybody_in_it(client, admin, auth):
    ops = _create(client, admin, "Operations")
    ada = auth(email="ada@softtrack.dev")
    _put_in(client, admin, ada, ops["id"])

    response = client.patch(
        f"/departments/{ops['id']}",
        json={"name": "Operations and Data"},
        headers=admin["headers"],
    )
    assert response.status_code == 200
    assert response.json()["member_count"] == 1
    assert _department_of(client, ada) == {
        "id": ops["id"],
        "name": "Operations and Data",
    }


def test_a_rename_can_change_only_the_case_but_not_take_another_name(client, admin):
    _create(client, admin, "Design")
    eng = _create(client, admin, "engineering")

    recased = client.patch(
        f"/departments/{eng['id']}",
        json={"name": "Engineering"},
        headers=admin["headers"],
    )
    assert recased.status_code == 200
    assert recased.json()["name"] == "Engineering"

    taken = client.patch(
        f"/departments/{eng['id']}", json={"name": "design"}, headers=admin["headers"]
    )
    assert taken.status_code == 400
    assert taken.json()["code"] == "department_name_taken"


def test_a_description_is_cleared_by_blank_or_null_and_kept_when_left_out(
    client, admin
):
    design = _create(client, admin, "Design", "Product design")
    url = f"/departments/{design['id']}"

    kept = client.patch(url, json={"name": "Design Team"}, headers=admin["headers"])
    assert kept.json()["description"] == "Product design"

    cleared = client.patch(url, json={"description": "  "}, headers=admin["headers"])
    assert cleared.json()["description"] is None


def test_an_unknown_department_is_a_404(client, admin):
    response = client.patch(
        "/departments/999", json={"name": "X"}, headers=admin["headers"]
    )
    assert response.status_code == 404
    assert response.json()["code"] == "department_not_found"
    assert (
        client.delete("/departments/999", headers=admin["headers"]).status_code == 404
    )


def test_losing_a_race_for_a_name_still_says_which_name(session, monkeypatch):
    """Two admins creating the same name at once both pass the check; the
    unique key refuses the second, and it gets the same sentence."""
    session.add(Department(name="Engineering", name_key="engineering"))
    session.commit()

    real_check = departments_service._assert_name_free
    calls = []

    def check_that_misses_the_first_time(*args, **kwargs):
        calls.append(args)
        if len(calls) == 1:
            return  # the other admin's row was not there yet
        real_check(*args, **kwargs)

    monkeypatch.setattr(
        departments_service, "_assert_name_free", check_that_misses_the_first_time
    )
    with pytest.raises(ApiError) as raised:
        departments_service.create_department(
            session, DepartmentCreate(name="ENGINEERING")
        )
    assert raised.value.code.value == "department_name_taken"
    assert "“Engineering” already exists" in raised.value.detail


# --- Deleting ----------------------------------------------------------------


def test_an_empty_department_just_goes(client, admin):
    research = _create(client, admin, "Research")
    response = client.delete(f"/departments/{research['id']}", headers=admin["headers"])
    assert response.status_code == 204
    assert client.get("/departments", headers=admin["headers"]).json() == []


def test_deleting_one_with_people_in_it_asks_where_they_go(client, admin, auth):
    cs = _create(client, admin, "Customer Success")
    ada = auth(email="ada@softtrack.dev")
    _put_in(client, admin, ada, cs["id"])

    response = client.delete(f"/departments/{cs['id']}", headers=admin["headers"])
    assert response.status_code == 409
    assert response.json()["code"] == "department_not_empty"
    # Nothing moved and nothing went.
    assert _department_of(client, ada)["name"] == "Customer Success"
    assert len(client.get("/departments", headers=admin["headers"]).json()) == 1


def test_its_people_move_to_the_department_chosen(client, admin, auth):
    cs = _create(client, admin, "Customer Success")
    support = _create(client, admin, "Support")
    ada = auth(email="ada@softtrack.dev")
    sam = auth(email="sam@softtrack.dev")
    _put_in(client, admin, ada, cs["id"])
    _put_in(client, admin, sam, cs["id"])
    # A deactivated account moves too: it points at the row like anybody.
    client.patch(
        f"/admin/users/{sam['user']['id']}",
        json={"is_active": False},
        headers=admin["headers"],
    )

    response = client.request(
        "DELETE",
        f"/departments/{cs['id']}",
        json={"move_to_id": support["id"]},
        headers=admin["headers"],
    )
    assert response.status_code == 204
    assert _department_of(client, ada)["name"] == "Support"
    [row] = client.get("/departments", headers=admin["headers"]).json()
    assert (row["name"], row["member_count"]) == ("Support", 2)


def test_or_to_no_department_when_the_choice_is_none(client, admin, auth):
    cs = _create(client, admin, "Customer Success")
    ada = auth(email="ada@softtrack.dev")
    _put_in(client, admin, ada, cs["id"])

    response = client.request(
        "DELETE",
        f"/departments/{cs['id']}",
        json={"move_to_id": None},
        headers=admin["headers"],
    )
    assert response.status_code == 204
    assert _department_of(client, ada) is None


def test_the_choice_has_to_be_another_department_that_exists(client, admin, auth):
    cs = _create(client, admin, "Customer Success")
    ada = auth(email="ada@softtrack.dev")
    _put_in(client, admin, ada, cs["id"])
    url = f"/departments/{cs['id']}"

    same = client.request(
        "DELETE", url, json={"move_to_id": cs["id"]}, headers=admin["headers"]
    )
    assert same.status_code == 400
    assert same.json()["code"] == "department_move_to_same"

    missing = client.request(
        "DELETE", url, json={"move_to_id": 999}, headers=admin["headers"]
    )
    assert missing.status_code == 400
    assert missing.json()["code"] == "department_not_found"

    # A body has to say it: an empty one is not "none".
    unsaid = client.request("DELETE", url, json={}, headers=admin["headers"])
    assert unsaid.status_code == 422
    assert _department_of(client, ada)["name"] == "Customer Success"


# --- Putting people in one ---------------------------------------------------


def test_a_site_admin_puts_someone_in_a_department_and_takes_them_out(
    client, admin, auth
):
    design = _create(client, admin, "Design")
    ada = auth(email="ada@softtrack.dev")

    row = _put_in(client, admin, ada, design["id"])
    assert row["department"] == {"id": design["id"], "name": "Design"}
    assert _department_of(client, ada) == {"id": design["id"], "name": "Design"}

    # A change about something else leaves it alone...
    client.patch(
        f"/admin/users/{ada['user']['id']}",
        json={"started_on": "2024-01-02"},
        headers=admin["headers"],
    )
    assert _department_of(client, ada)["name"] == "Design"

    # ...and an explicit null takes them out.
    assert _put_in(client, admin, ada, None)["department"] is None


def test_the_directory_rows_carry_the_department(client, admin, auth):
    design = _create(client, admin, "Design")
    ada = auth(email="ada@softtrack.dev")
    _put_in(client, admin, ada, design["id"])

    items = client.get("/admin/users", headers=admin["headers"]).json()["items"]
    by_email = {row["email"]: row["department"] for row in items}
    assert by_email == {
        "admin@softtrack.dev": None,
        "ada@softtrack.dev": {"id": design["id"], "name": "Design"},
    }


def test_an_unknown_department_cannot_be_assigned(client, admin, auth):
    ada = auth(email="ada@softtrack.dev")
    response = client.patch(
        f"/admin/users/{ada['user']['id']}",
        json={"department_id": 999},
        headers=admin["headers"],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "department_not_found"


def test_nobody_puts_themselves_in_a_department(client, admin, auth):
    design = _create(client, admin, "Design")
    ada = auth(email="ada@softtrack.dev")
    response = client.patch(
        "/auth/me", json={"department_id": design["id"]}, headers=ada["headers"]
    )
    assert response.status_code == 200
    assert response.json()["department"] is None


def test_the_directory_loads_departments_for_the_page_not_per_row(session):
    """Departments are read with the page, so a longer page costs no more."""

    def queries_for(count):
        design = Department(name=f"Design {count}", name_key=f"design {count}")
        session.add(design)
        session.commit()
        for k in range(count):
            session.add(
                User(
                    email=f"p{count}-{k}@softtrack.dev",
                    username=f"p{count}-{k}",
                    hashed_password="x",
                    full_name=f"P{k}",
                    department_id=design.id,
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
            page = admin_service.list_users(session, q=f"p{count}-")
        finally:
            event.remove(engine, "before_cursor_execute", record)
        assert all(row.department is not None for row in page.items)
        return len(statements)

    assert queries_for(3) == queries_for(12)
