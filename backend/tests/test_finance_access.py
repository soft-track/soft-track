"""Who can see money at all (#130): the finance-admin flag and its guard."""

import importlib
import inspect
import logging
import pkgutil

import pytest
from fastapi.routing import iter_route_contexts
from pydantic import BaseModel

import lib_finance.models
from lib_finance.access import require_finance_admin
from lib_softtrack.tables import User
from lib_utils.errors import ApiError
from main import app


class _Lines(logging.Handler):
    def __init__(self):
        super().__init__(logging.INFO)
        self.lines: list[str] = []

    def emit(self, record):
        if record.getMessage().startswith("finance_admin."):
            self.lines.append(record.getMessage())


@pytest.fixture
def finance_log():
    """The finance access lines the app writes, as they were written.

    Listened for on the logger itself rather than through caplog: a test that
    starts a real server leaves uvicorn's logging config behind, and that
    stops its loggers propagating to the root, where caplog listens.
    """
    logger = logging.getLogger("uvicorn.error")
    handler, level = _Lines(), logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    yield handler.lines
    logger.removeHandler(handler)
    logger.setLevel(level)


def grant(client, admin, person, granted=True):
    response = client.patch(
        f"/admin/users/{person['user']['id']}",
        json={"is_finance_admin": granted},
        headers=admin["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_nobody_can_see_money_to_begin_with_not_even_the_site_admin(client, auth):
    sofia = auth(email="sofia@softtrack.dev")
    mei = auth(email="mei@softtrack.dev")
    assert sofia["user"]["is_site_admin"] is True
    assert sofia["user"]["is_finance_admin"] is False
    assert mei["user"]["is_finance_admin"] is False


def test_a_site_admin_grants_it_and_the_row_says_when_and_by_whom(
    client, auth, finance_log
):
    sofia = auth(email="sofia@softtrack.dev", full_name="Sofia Marquez")
    mei = auth(email="mei@softtrack.dev", full_name="Mei Chen")

    row = grant(client, sofia, mei)

    assert row["is_finance_admin"] is True
    assert row["is_site_admin"] is False
    assert row["finance_admin_since"] is not None
    assert row["finance_admin_granted_by"]["username"] == "sofia"
    assert client.get("/auth/me", headers=mei["headers"]).json()["is_finance_admin"]

    [line] = finance_log
    assert line.startswith("finance_admin.granted at=")
    assert line.endswith(" by=sofia user=mei")


def test_revoking_clears_the_grant_and_is_logged_too(client, auth, finance_log):
    sofia = auth(email="sofia@softtrack.dev")
    mei = auth(email="mei@softtrack.dev")
    grant(client, sofia, mei)
    finance_log.clear()

    row = grant(client, sofia, mei, granted=False)

    assert row["is_finance_admin"] is False
    assert row["finance_admin_since"] is None
    assert row["finance_admin_granted_by"] is None
    assert [line.split(" at=")[0] for line in finance_log] == ["finance_admin.revoked"]


def test_granting_what_they_already_have_changes_and_logs_nothing(
    client, auth, finance_log
):
    sofia = auth(email="sofia@softtrack.dev")
    mei = auth(email="mei@softtrack.dev")
    first = grant(client, sofia, mei)
    finance_log.clear()

    again = grant(client, sofia, mei)

    assert again["finance_admin_since"] == first["finance_admin_since"]
    assert finance_log == []


def test_a_site_admin_may_grant_it_to_themselves_and_give_it_up(client, auth):
    """No lockout to guard against: whoever granted it can grant it again."""
    sofia = auth(email="sofia@softtrack.dev")
    assert grant(client, sofia, sofia)["is_finance_admin"] is True
    assert grant(client, sofia, sofia, granted=False)["is_finance_admin"] is False


def test_finance_access_does_not_include_site_admin(client, auth):
    sofia = auth(email="sofia@softtrack.dev")
    grace = auth(email="grace@softtrack.dev")
    mei = auth(email="mei@softtrack.dev")
    grant(client, sofia, grace)

    for response in (
        client.get("/admin/users", headers=grace["headers"]),
        client.patch(
            f"/admin/users/{mei['user']['id']}",
            json={"is_finance_admin": True},
            headers=grace["headers"],
        ),
    ):
        assert response.status_code == 403
        assert response.json()["code"] == "not_site_admin"


def test_deactivating_someone_takes_their_finance_access_with_it(
    client, auth, finance_log
):
    """Like their API tokens: coming back does not quietly bring it back."""
    sofia = auth(email="sofia@softtrack.dev")
    grace = auth(email="grace@softtrack.dev")
    grant(client, sofia, grace)
    finance_log.clear()

    client.patch(
        f"/admin/users/{grace['user']['id']}",
        json={"is_active": False},
        headers=sofia["headers"],
    )
    row = client.patch(
        f"/admin/users/{grace['user']['id']}",
        json={"is_active": True},
        headers=sofia["headers"],
    ).json()

    assert row["is_active"] is True
    assert row["is_finance_admin"] is False
    assert [line.split(" at=")[0] for line in finance_log] == ["finance_admin.revoked"]


def test_the_directory_filters_by_role(client, auth):
    sofia = auth(email="sofia@softtrack.dev")
    grace = auth(email="grace@softtrack.dev")
    auth(email="mei@softtrack.dev")
    grant(client, sofia, grace)

    def usernames(role):
        response = client.get(f"/admin/users?role={role}", headers=sofia["headers"])
        assert response.status_code == 200, response.text
        return [row["username"] for row in response.json()["items"]]

    assert usernames("site_admin") == ["sofia"]
    assert usernames("finance_admin") == ["grace"]
    assert (
        client.get("/admin/users?role=owner", headers=sofia["headers"]).status_code
        == 422
    )


def test_the_people_directory_does_not_say_who_holds_it(client, auth):
    sofia = auth(email="sofia@softtrack.dev")
    grace = auth(email="grace@softtrack.dev")
    grant(client, sofia, grace)

    listing = client.get("/users", headers=sofia["headers"]).json()
    profile = client.get("/users/grace", headers=sofia["headers"]).json()
    for row in [*listing["items"], profile]:
        assert not [key for key in row if "finance" in key]


def test_the_guard_refuses_without_the_flag_and_passes_with_it():
    mei = User(email="mei@b.c", username="mei", hashed_password="x", full_name="Mei")
    with pytest.raises(ApiError) as refused:
        require_finance_admin(mei)
    assert refused.value.status_code == 403
    assert refused.value.code == "not_finance_admin"

    mei.is_finance_admin = True
    assert require_finance_admin(mei) is mei


def _depends_on(dependant, call) -> bool:
    return any(
        sub.call is call or _depends_on(sub, call) for sub in dependant.dependencies
    )


def _routes():
    """Every route the app serves, as (path, dependant). Walked through the
    routers it includes: `app.routes` alone holds the routers, not their
    routes."""
    return [
        (route.path, route.dependant)
        for route in iter_route_contexts(app.routes)
        if getattr(route, "dependant", None) is not None
    ]


def test_every_route_under_finance_requires_the_flag():
    """The guard is the router's (`finance_router`), so this holds by
    construction -- and fails loudly for a route that found another way in."""
    routes = _routes()
    # The walk reaches into included routers, or this would pass on nothing.
    assert "/admin/users" in {path for path, _ in routes}, routes
    unguarded = [
        path
        for path, dependant in routes
        if path.startswith("/finance")
        and not _depends_on(dependant, require_finance_admin)
    ]
    assert unguarded == []


def test_the_line_survives_the_migrations_the_app_runs_on_startup(tmp_path):
    """alembic/env.py used to switch every existing logger off, uvicorn's
    included, from the lifespan -- silently dropping this line in production."""
    from alembic import command

    from tests.test_reactions_migration import _config

    logger = logging.getLogger("uvicorn.error")
    command.upgrade(_config(tmp_path / "startup.db"), "head")
    assert not logger.disabled


#: Finance schemas a route outside /finance may return, and why. Everything
#: else in lib_finance/models is for finance admins' eyes only.
SHARED_FINANCE_SCHEMAS = {
    "CurrencyRead": "a list of currencies is no secret",
}


def _finance_schemas() -> set[str]:
    names = set()
    for module in pkgutil.iter_modules(lib_finance.models.__path__):
        loaded = importlib.import_module(f"lib_finance.models.{module.name}")
        names |= {
            name
            for name, value in vars(loaded).items()
            if inspect.isclass(value)
            and issubclass(value, BaseModel)
            and value.__module__ == loaded.__name__
        }
    return names


def test_no_route_outside_finance_can_return_a_finance_schema():
    """Finance fields live in their own schemas so that a model reused
    somewhere else cannot carry a salary out with it (#130). Follow every
    response outside /finance through every schema it points at."""
    schema = app.openapi()
    components = schema["components"]["schemas"]

    def reach(node, found):
        if isinstance(node, dict):
            ref = node.get("$ref")
            if ref and ref.rsplit("/", 1)[-1] not in found:
                name = ref.rsplit("/", 1)[-1]
                found.add(name)
                reach(components[name], found)
            for value in node.values():
                reach(value, found)
        elif isinstance(node, list):
            for value in node:
                reach(value, found)

    outside: set[str] = set()
    for path, operations in schema["paths"].items():
        if not path.startswith("/finance"):
            for operation in operations.values():
                reach(operation.get("responses", {}), outside)

    finance = _finance_schemas()
    assert "CompensationRecordRead" in finance
    assert outside & finance <= set(SHARED_FINANCE_SCHEMAS)
