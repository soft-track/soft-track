"""Machine-readable codes on API errors (issue #86).

The body gains `code` beside the `detail` it always had. These pin the shape,
that the English is unchanged, and -- by reading the source -- that every
error raised on purpose carries a code and every listed code is used.
"""

import ast
import pathlib
import re

from lib_utils.errors import ErrorCode

BACKEND = pathlib.Path(__file__).resolve().parents[1]
SOURCE_DIRS = [
    "lib_softtrack",
    "lib_identity",
    "lib_utils",
    "app_softtrack",
    "app_identity",
]


def _sources():
    for directory in SOURCE_DIRS:
        yield from (BACKEND / directory).rglob("*.py")


def test_a_permission_error_carries_its_code_and_the_same_sentence(client, team, auth):
    member = auth(email="member@softtrack.dev", full_name="Plain Member")
    client.post(
        f"/teams/{team['team']['id']}/members",
        json={"email": "member@softtrack.dev"},
        headers=team["headers"],
    )
    response = client.patch(
        f"/teams/{team['team']['id']}",
        json={"name": "Renamed"},
        headers=member["headers"],
    )
    assert response.status_code == 403
    assert response.json() == {
        "detail": "Only team admins can do that",
        "code": "not_team_admin",
    }


def test_a_missing_thing_says_which(client, team):
    response = client.get("/issues/999999", headers=team["headers"])
    assert response.status_code == 404
    assert response.json() == {"detail": "Issue not found", "code": "issue_not_found"}


def test_a_failed_sign_in(client, auth):
    auth(email="sam@example.com")
    response = client.post(
        "/auth/login", data={"username": "sam@example.com", "password": "wrong-one"}
    )
    assert response.status_code == 401
    assert response.json()["code"] == "bad_credentials"


def test_a_bad_token_is_not_authenticated(client):
    response = client.get("/auth/me", headers={"Authorization": "Bearer nonsense"})
    assert response.status_code == 401
    assert response.json()["code"] == "not_authenticated"
    # The header a 401 has always carried survives the new handler.
    assert response.headers["www-authenticate"] == "Bearer"


def test_a_rate_limit_keeps_its_retry_after(client, auth):
    auth(email="sam@example.com")
    for _ in range(6):
        response = client.post(
            "/auth/login", data={"username": "sam@example.com", "password": "nope"}
        )
    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"
    assert int(response.headers["retry-after"]) >= 1


def test_request_validation_keeps_its_own_shape(client, team):
    """422s from FastAPI's request checking already say what was wrong,
    field by field, and are left exactly as they were."""
    response = client.post(
        f"/teams/{team['team']['id']}/issues", json={}, headers=team["headers"]
    )
    assert response.status_code == 422
    assert "code" not in response.json()
    assert isinstance(response.json()["detail"], list)


def test_the_codes_are_published_in_the_schema(client):
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    assert set(schemas["ErrorCode"]["enum"]) == {code.value for code in ErrorCode}
    assert schemas["ApiErrorBody"]["required"] == ["detail", "code"]


def test_every_code_is_a_stable_snake_case_name():
    for code in ErrorCode:
        assert code.value == code.name
        assert re.fullmatch(r"[a-z][a-z0-9_]*", code.value), code


def test_no_error_is_raised_without_a_code():
    """A bare HTTPException would reach the client with no code. `except
    HTTPException` is still fine -- ApiError is one."""
    bare = [
        f"{path.relative_to(BACKEND)}:{node.lineno}"
        for path in _sources()
        if path.name != "errors.py"
        for node in ast.walk(ast.parse(path.read_text()))
        if isinstance(node, ast.Call)
        and getattr(node.func, "id", None) == "HTTPException"
    ]
    assert bare == []


def test_every_listed_code_is_raised_somewhere():
    """The enum is the documentation, so it must not list codes that no
    longer happen."""
    source = "\n".join(path.read_text() for path in _sources())
    unused = [code.name for code in ErrorCode if f"ErrorCode.{code.name}" not in source]
    assert unused == []
