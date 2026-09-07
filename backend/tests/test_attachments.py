"""File attachments on issues and comments (issue #15).

Two properties most of this file exists to protect.

**A file is served back as the type the server decided, never the type the
upload claimed.** An attachment endpoint that echoes a client's Content-Type
is a stored cross-site scripting bug wearing a paperclip.

**Deleting an issue takes its attachments with it, rows and bytes.** That is
the same class of bug as soft-track#1: a row pointing at something that is
gone, or bytes on disk that nothing will ever reference again.
"""

import io
from pathlib import Path

import pytest
from sqlmodel import select

from lib_softtrack.attachments import safe_filename
from lib_softtrack.storage import (
    LocalStorage,
    ObjectNotFound,
    S3Storage,
    build_storage,
)
from lib_softtrack.tables import Attachment

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff" + b"\x00" * 64


def make_issue(client, team, title="Something is broken"):
    response = client.post(
        f"/teams/{team['team']['id']}/issues",
        json={"title": title},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


def upload(
    client,
    headers,
    issue,
    body=PNG,
    name="screenshot.png",
    declared_type="image/png",
):
    return client.post(
        f"/issues/{issue['id']}/attachments",
        files={"file": (name, io.BytesIO(body), declared_type)},
        headers=headers,
    )


def attach(client, team, issue, **kwargs):
    """Upload and assert it worked, for the tests that are about what happens next."""
    response = upload(client, team["headers"], issue, **kwargs)
    assert response.status_code == 200, response.text
    return response.json()


# --- uploading ---------------------------------------------------------


def test_uploading_a_screenshot(client, team):
    issue = make_issue(client, team)
    body = attach(client, team, issue)

    assert body["filename"] == "screenshot.png"
    assert body["content_type"] == "image/png"
    assert body["size_bytes"] == len(PNG)
    assert body["is_image"] is True
    assert body["comment_id"] is None
    assert body["url"] == f"/attachments/{body['id']}/content"
    assert body["uploaded_by"]["id"] == team["user"]["id"]


def test_the_url_is_relative_to_the_api(client, team):
    """It gets written into markdown, so it must not carry a hostname."""
    issue = make_issue(client, team)
    assert attach(client, team, issue)["url"].startswith("/attachments/")


def test_the_content_type_comes_from_the_name_not_the_upload(client, team):
    """The whole file is served back with this type, so it cannot be chosen
    by whoever is uploading."""
    issue = make_issue(client, team)
    body = attach(client, team, issue, declared_type="text/html")
    assert body["content_type"] == "image/png"


@pytest.mark.parametrize(
    "name",
    ["evil.html", "evil.svg", "run.sh", "payload.xhtml", "noextension"],
)
def test_types_that_are_not_on_the_allowlist_are_refused(client, team, name):
    issue = make_issue(client, team)
    response = upload(client, team["headers"], issue, name=name, body=b"<x>")
    assert response.status_code == 415, response.text
    # the message has to say what would work
    assert ".png" in response.json()["detail"]


def test_an_svg_is_refused_even_though_it_is_an_image(client, team):
    """An SVG is a document that can carry script. There is no way to serve
    one inline safely, so it is not accepted at all."""
    issue = make_issue(client, team)
    response = upload(
        client,
        team["headers"],
        issue,
        name="diagram.svg",
        body=b'<svg onload="alert(1)"/>',
        declared_type="image/svg+xml",
    )
    assert response.status_code == 415


def test_a_file_that_is_not_the_image_it_claims_to_be_is_refused(client, team):
    issue = make_issue(client, team)
    response = upload(client, team["headers"], issue, body=b"not a png at all")
    assert response.status_code == 422
    assert "PNG" in response.json()["detail"]


def test_a_jpeg_is_accepted(client, team):
    issue = make_issue(client, team)
    body = attach(client, team, issue, body=JPEG, name="photo.jpg")
    assert body["content_type"] == "image/jpeg"


def test_a_non_image_is_not_signature_checked(client, team):
    """Only images are, because only images fail silently as a broken <img>."""
    issue = make_issue(client, team)
    body = attach(client, team, issue, body=b"line one\n", name="server.log")
    assert body["content_type"] == "text/plain"
    assert body["is_image"] is False


def test_an_empty_file_is_refused(client, team):
    issue = make_issue(client, team)
    response = upload(client, team["headers"], issue, body=b"")
    assert response.status_code == 422


def test_a_file_over_the_limit_is_refused(client, team, monkeypatch):
    from web import settings

    monkeypatch.setattr(settings, "attachment_max_bytes", 128)
    issue = make_issue(client, team)
    response = upload(client, team["headers"], issue, body=PNG + b"\x00" * 200)
    assert response.status_code == 413
    assert "larger than" in response.json()["detail"]


def test_a_file_exactly_at_the_limit_is_accepted(client, team, monkeypatch):
    """An off-by-one here refuses a file the documented limit allows."""
    from web import settings

    body = PNG + b"\x00" * (256 - len(PNG))
    monkeypatch.setattr(settings, "attachment_max_bytes", len(body))
    issue = make_issue(client, team)
    assert upload(client, team["headers"], issue, body=body).status_code == 200


def test_a_directory_in_the_filename_is_stripped(client, team):
    issue = make_issue(client, team)
    body = attach(client, team, issue, name="../../etc/passwd.png")
    assert body["filename"] == "passwd.png"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("C:\\Users\\me\\shot.png", "shot.png"),
        ("/etc/passwd", "passwd"),
        ("../../x.png", "x.png"),
        ("  spaced.png  ", "spaced.png"),
        ("...", ""),
        ("", ""),
    ],
)
def test_filenames_are_reduced_to_a_bare_name(raw, expected):
    assert safe_filename(raw) == expected


def test_a_long_filename_is_truncated(client, team):
    issue = make_issue(client, team)
    body = attach(client, team, issue, name="a" * 500 + ".png")
    assert len(body["filename"]) <= 200


def test_uploading_to_an_issue_in_another_team_is_refused(client, team, auth):
    issue = make_issue(client, team)
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    assert upload(client, outsider["headers"], issue).status_code == 403


def test_uploading_to_an_issue_that_does_not_exist(client, team):
    assert upload(client, team["headers"], {"id": 9999}).status_code == 404


# --- serving the bytes back --------------------------------------------


def test_downloading_returns_the_bytes(client, team):
    issue = make_issue(client, team)
    body = attach(client, team, issue)

    response = client.get(body["url"], headers=team["headers"])
    assert response.status_code == 200
    assert response.content == PNG
    assert response.headers["content-type"].startswith("image/png")


def test_an_image_is_served_inline_and_a_document_as_a_download(client, team):
    issue = make_issue(client, team)
    image = attach(client, team, issue)
    document = attach(client, team, issue, body=b"log line", name="server.log")

    inline = client.get(image["url"], headers=team["headers"])
    download = client.get(document["url"], headers=team["headers"])

    assert inline.headers["content-disposition"].startswith("inline;")
    assert download.headers["content-disposition"].startswith("attachment;")


def test_the_response_forbids_content_sniffing(client, team):
    """The derived content type is only worth anything if the browser honours it."""
    issue = make_issue(client, team)
    body = attach(client, team, issue)
    response = client.get(body["url"], headers=team["headers"])

    assert response.headers["x-content-type-options"] == "nosniff"
    assert "default-src 'none'" in response.headers["content-security-policy"]


def test_a_non_ascii_filename_survives_the_round_trip(client, team):
    issue = make_issue(client, team)
    body = attach(client, team, issue, name="ekran görüntüsü.png")
    assert body["filename"] == "ekran görüntüsü.png"

    disposition = client.get(body["url"], headers=team["headers"]).headers[
        "content-disposition"
    ]
    # the RFC 5987 spelling carries the real name; the plain one stays ASCII
    assert "filename*=UTF-8''ekran%20g%C3%B6r%C3%BCnt%C3%BCs%C3%BC.png" in disposition


def test_downloading_needs_to_be_signed_in(client, team):
    issue = make_issue(client, team)
    body = attach(client, team, issue)
    assert client.get(body["url"]).status_code == 401


def test_someone_outside_the_team_cannot_download(client, team, auth):
    issue = make_issue(client, team)
    body = attach(client, team, issue)
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    assert client.get(body["url"], headers=outsider["headers"]).status_code == 403


def test_bytes_missing_under_a_live_row_report_gone_rather_than_broken(
    client, team, storage, session
):
    issue = make_issue(client, team)
    body = attach(client, team, issue)
    row = session.get(Attachment, body["id"])
    storage.delete(row.storage_key)

    response = client.get(body["url"], headers=team["headers"])
    # 410, not 500: retrying cannot fix it, and the request was not at fault
    assert response.status_code == 410


def test_downloading_an_attachment_that_does_not_exist(client, team):
    assert (
        client.get("/attachments/9999/content", headers=team["headers"]).status_code
        == 404
    )


# --- listing -----------------------------------------------------------


def test_the_issue_lists_its_own_files(client, team):
    issue = make_issue(client, team)
    first = attach(client, team, issue, name="one.png")
    second = attach(client, team, issue, name="two.png")

    response = client.get(f"/issues/{issue['id']}/attachments", headers=team["headers"])
    assert response.status_code == 200
    assert [a["id"] for a in response.json()] == [first["id"], second["id"]]


def test_a_file_claimed_by_a_comment_leaves_the_issue_list(client, team):
    """Each file is listed in exactly one place, so the UI never dedupes."""
    issue = make_issue(client, team)
    body = attach(client, team, issue)
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "see this", "attachment_ids": [body["id"]]},
        headers=team["headers"],
    )

    listed = client.get(
        f"/issues/{issue['id']}/attachments", headers=team["headers"]
    ).json()
    assert listed == []


def test_listing_needs_team_membership(client, team, auth):
    issue = make_issue(client, team)
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    response = client.get(
        f"/issues/{issue['id']}/attachments", headers=outsider["headers"]
    )
    assert response.status_code == 403


# --- comments ----------------------------------------------------------


def test_a_comment_claims_the_files_uploaded_while_it_was_written(client, team):
    issue = make_issue(client, team)
    body = attach(client, team, issue)

    response = client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "Here is what I see", "attachment_ids": [body["id"]]},
        headers=team["headers"],
    )
    assert response.status_code == 200, response.text
    comment = response.json()
    assert [a["id"] for a in comment["attachments"]] == [body["id"]]
    assert comment["attachments"][0]["comment_id"] == comment["id"]


def test_listing_comments_carries_their_attachments(client, team):
    issue = make_issue(client, team)
    body = attach(client, team, issue)
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "with a file", "attachment_ids": [body["id"]]},
        headers=team["headers"],
    )
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "without one"},
        headers=team["headers"],
    )

    items = client.get(
        f"/issues/{issue['id']}/comments", headers=team["headers"]
    ).json()["items"]
    assert [len(c["attachments"]) for c in items] == [1, 0]


def test_a_comment_cannot_claim_a_file_from_another_issue(client, team):
    """Otherwise a file walks to an issue its uploader never put it on."""
    first, second = make_issue(client, team, "A"), make_issue(client, team, "B")
    body = attach(client, team, first)

    response = client.post(
        f"/issues/{second['id']}/comments",
        json={"body": "not mine", "attachment_ids": [body["id"]]},
        headers=team["headers"],
    )
    assert response.status_code == 400


def test_a_comment_cannot_claim_a_file_another_comment_already_has(client, team):
    issue = make_issue(client, team)
    body = attach(client, team, issue)
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "first", "attachment_ids": [body["id"]]},
        headers=team["headers"],
    )

    response = client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "second", "attachment_ids": [body["id"]]},
        headers=team["headers"],
    )
    assert response.status_code == 400


def test_a_rejected_claim_does_not_leave_the_comment_behind(client, team):
    """The claim is part of posting the comment, not a step after it."""
    issue = make_issue(client, team)
    before = client.get(f"/issues/{issue['id']}/comments", headers=team["headers"])

    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "doomed", "attachment_ids": [9999]},
        headers=team["headers"],
    )

    after = client.get(f"/issues/{issue['id']}/comments", headers=team["headers"])
    assert after.json()["total"] == before.json()["total"]


# --- deleting ----------------------------------------------------------


def test_deleting_an_attachment_removes_the_bytes_too(client, team, storage, session):
    issue = make_issue(client, team)
    body = attach(client, team, issue)
    key = session.get(Attachment, body["id"]).storage_key

    assert (
        client.delete(f"/attachments/{body['id']}", headers=team["headers"]).status_code
        == 204
    )
    assert session.get(Attachment, body["id"]) is None
    with pytest.raises(ObjectNotFound):
        storage.open(key)


def test_someone_outside_the_team_cannot_delete(client, team, auth):
    issue = make_issue(client, team)
    body = attach(client, team, issue)
    outsider = auth(email="outsider@softtrack.dev", full_name="Outsider")
    assert (
        client.delete(
            f"/attachments/{body['id']}", headers=outsider["headers"]
        ).status_code
        == 403
    )


def test_deleting_an_issue_deletes_its_attachments(client, team, storage, session):
    """The soft-track#1 shape: a row left pointing at something that is gone."""
    issue = make_issue(client, team)
    on_issue = attach(client, team, issue, name="one.png")
    on_comment = attach(client, team, issue, name="two.png")
    client.post(
        f"/issues/{issue['id']}/comments",
        json={"body": "see attached", "attachment_ids": [on_comment["id"]]},
        headers=team["headers"],
    )
    keys = [
        session.get(Attachment, on_issue["id"]).storage_key,
        session.get(Attachment, on_comment["id"]).storage_key,
    ]

    response = client.delete(f"/issues/{issue['id']}", headers=team["headers"])
    assert response.status_code == 204, response.text

    assert (
        session.exec(select(Attachment).where(Attachment.issue_id == issue["id"])).all()
        == []
    )
    for key in keys:
        with pytest.raises(ObjectNotFound):
            storage.open(key)


# --- the storage backends ----------------------------------------------


def test_local_storage_round_trips(tmp_path):
    storage = LocalStorage(tmp_path)
    storage.write("ab/" + "a" * 32, b"hello")
    with storage.open("ab/" + "a" * 32) as handle:
        assert handle.read() == b"hello"


def test_local_storage_reports_a_missing_object(tmp_path):
    with pytest.raises(ObjectNotFound):
        LocalStorage(tmp_path).open("ab/" + "b" * 32)


def test_deleting_a_local_object_that_is_already_gone_is_fine(tmp_path):
    """purge() runs after the commit, so it must not raise on a repeat."""
    LocalStorage(tmp_path).delete("ab/" + "c" * 32)


def test_local_storage_leaves_no_partial_file_behind(tmp_path):
    storage = LocalStorage(tmp_path)
    storage.write("ab/" + "d" * 32, b"x" * 1000)
    assert [p.suffix for p in tmp_path.rglob("*") if p.is_file()] == [""]


@pytest.mark.parametrize(
    "key",
    ["../escape", "ab/../../etc/passwd", "/absolute", "ab/name.PNG", "nested/a/b"],
)
def test_storage_refuses_a_key_of_the_wrong_shape(tmp_path, key):
    """Keys are generated, never taken from a request. This is the second
    lock: a bug in the caller should cost an error, not a file write."""
    with pytest.raises(ValueError):
        LocalStorage(tmp_path).write(key, b"x")


class NoSuchKey(Exception):
    """botocore generates its exception classes; only the name is stable."""


class FakeS3:
    """Enough of botocore's client to test the key and error handling."""

    def __init__(self):
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_object(self, Bucket, Key, Body):  # noqa: N803 -- botocore's spelling
        self.objects[(Bucket, Key)] = Body

    def get_object(self, Bucket, Key):  # noqa: N803
        try:
            return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}
        except KeyError:
            raise NoSuchKey(Key)

    def delete_object(self, Bucket, Key):  # noqa: N803
        self.objects.pop((Bucket, Key), None)


def test_s3_storage_round_trips_under_its_prefix():
    fake = FakeS3()
    storage = S3Storage("files", prefix="softtrack/", client=fake)
    key = "ab/" + "e" * 32

    storage.write(key, b"hello")
    assert ("files", f"softtrack/{key}") in fake.objects
    assert storage.open(key).read() == b"hello"

    storage.delete(key)
    assert fake.objects == {}


def test_s3_storage_without_a_prefix_uses_the_bare_key():
    fake = FakeS3()
    S3Storage("files", client=fake).write("ab/" + "f" * 32, b"x")
    assert ("files", "ab/" + "f" * 32) in fake.objects


def test_s3_storage_checks_keys_the_same_way():
    with pytest.raises(ValueError):
        S3Storage("files", client=FakeS3()).write("../escape", b"x")


def test_build_storage_defaults_to_local(tmp_path):
    from web import Settings

    storage = build_storage(Settings(attachment_dir=str(tmp_path)))
    assert isinstance(storage, LocalStorage)
    assert storage.root == Path(tmp_path)


def test_build_storage_rejects_a_backend_it_does_not_have():
    from web import Settings

    settings = Settings()
    # past the validator on purpose: this is the second line of defence
    object.__setattr__(settings, "attachment_storage", "gopher")
    with pytest.raises(ValueError, match="Unknown ATTACHMENT_STORAGE"):
        build_storage(settings)


def test_s3_storage_needs_a_bucket_before_the_app_starts():
    """A missing bucket is otherwise found on the first upload, days later."""
    from pydantic import ValidationError

    from web import Settings

    with pytest.raises(ValidationError, match="ATTACHMENT_S3_BUCKET"):
        Settings(attachment_storage="s3")


def test_an_unknown_storage_backend_is_refused_at_startup():
    from pydantic import ValidationError

    from web import Settings

    with pytest.raises(ValidationError, match="ATTACHMENT_STORAGE"):
        Settings(attachment_storage="gopher")


def test_s3_storage_reports_a_missing_object_the_same_way_local_does():
    """Callers switch backends without switching error handling."""
    with pytest.raises(ObjectNotFound):
        S3Storage("files", client=FakeS3()).open("ab/" + "0" * 32)


def test_s3_storage_does_not_swallow_an_unrelated_failure():
    """A permissions error is not a missing file, and must not read as one."""

    class Broken(FakeS3):
        def get_object(self, Bucket, Key):  # noqa: N803
            raise RuntimeError("connection reset")

    with pytest.raises(RuntimeError):
        S3Storage("files", client=Broken()).open("ab/" + "1" * 32)


def test_deleting_an_s3_object_that_is_already_gone_is_fine():
    S3Storage("files", client=FakeS3()).delete("ab/" + "2" * 32)


def test_build_storage_passes_the_endpoint_and_region_to_the_client(monkeypatch):
    """The settings a MinIO or R2 deployment sets have to reach boto3."""
    import sys
    import types

    calls = {}

    def client(service, **kwargs):
        calls.update({"service": service, **kwargs})
        return FakeS3()

    monkeypatch.setitem(sys.modules, "boto3", types.SimpleNamespace(client=client))

    from web import Settings

    storage = build_storage(
        Settings(
            attachment_storage="s3",
            attachment_s3_bucket="files",
            attachment_s3_endpoint_url="https://minio.example:9000",
            attachment_s3_region="eu-west-1",
            attachment_s3_prefix="softtrack",
        )
    )

    assert isinstance(storage, S3Storage)
    assert storage.bucket == "files"
    assert calls == {
        "service": "s3",
        "endpoint_url": "https://minio.example:9000",
        "region_name": "eu-west-1",
    }


def test_a_filename_that_reduces_to_nothing_is_refused(client, team):
    issue = make_issue(client, team)
    response = upload(client, team["headers"], issue, name="...")
    assert response.status_code == 422
    assert "name" in response.json()["detail"]


def test_a_long_filename_keeps_its_extension(client, team):
    """Truncating past the extension would change what the file is -- the
    content type is derived from it -- and the upload would be refused."""
    issue = make_issue(client, team)
    body = attach(client, team, issue, name="a" * 500 + ".png")
    assert body["filename"].endswith(".png")
    assert body["content_type"] == "image/png"
