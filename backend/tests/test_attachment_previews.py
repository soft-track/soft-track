"""Previewing PDFs and text files (#101): what the server says about a file,
and the headers it serves the bytes with.

The frontend fetches the bytes with the user's token and shows them from a
blob, so these headers are not what makes a preview render. They are what
keeps the bytes safe for anything else that fetches them -- which is why text
is always plain text, whatever it was uploaded as.
"""

import io

import pytest

from lib_softtrack.storage import copy_range
from lib_utils.errors import ApiError
from lib_utils.ranges import parse_range
from tests.test_attachments import PNG, attach, make_issue, upload

PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


@pytest.mark.parametrize(
    ("name", "body", "preview"),
    [
        ("shot.png", PNG, "image"),
        ("spec.pdf", PDF, "pdf"),
        ("server.log", b"boot\n", "text"),
        ("notes.md", b"# Notes\n", "text"),
        ("rows.csv", b"a,b\n1,2\n", "text"),
        ("payload.json", b'{"a": 1}', "text"),
        ("retry.py", b"def retry(): ...\n", "text"),
        ("config.yaml", b"a: 1\n", "text"),
        ("dump.zip", b"PK\x03\x04", None),
        ("clip.mp4", b"\x00\x00\x00\x18ftyp", None),
    ],
)
def test_each_file_says_how_it_can_be_previewed(client, team, name, body, preview):
    issue = make_issue(client, team)
    assert attach(client, team, issue, body=body, name=name)["preview"] == preview


@pytest.mark.parametrize(
    "name", ["notes.md", "rows.csv", "payload.json", "server.log", "app.ts"]
)
def test_text_is_always_served_as_plain_text(client, team, name):
    """Markdown or JSON served as itself is something a browser may render."""
    issue = make_issue(client, team)
    attachment = attach(
        client, team, issue, body=b"<script>alert(1)</script>", name=name
    )
    response = client.get(attachment["url"], headers=team["headers"])

    assert response.headers["content-type"] == "text/plain; charset=utf-8"
    assert response.headers["content-disposition"].startswith("inline;")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in response.headers["content-security-policy"]
    # The file itself is untouched: what it *is* is still recorded.
    assert response.content == b"<script>alert(1)</script>"


def test_a_pdf_is_served_as_a_pdf_inline(client, team):
    issue = make_issue(client, team)
    attachment = attach(client, team, issue, body=PDF, name="spec.pdf")
    response = client.get(attachment["url"], headers=team["headers"])
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"].startswith("inline;")


def test_a_pdf_has_to_be_one(client, team):
    issue = make_issue(client, team)
    response = upload(
        client, team["headers"], issue, body=b"<html>not a pdf", name="spec.pdf"
    )
    assert response.status_code == 422
    assert response.json()["code"] == "attachment_content_mismatch"


def test_a_pdf_may_have_a_little_junk_before_its_header(client, team):
    """Readers allow it, so refusing it would refuse PDFs people can open."""
    issue = make_issue(client, team)
    response = upload(
        client, team["headers"], issue, body=b"\x00" * 100 + PDF, name="spec.pdf"
    )
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("name", ["evil.html", "evil.svg", "run.sh", "page.xml"])
def test_markup_and_scripts_stay_refused(client, team, name):
    issue = make_issue(client, team)
    response = upload(client, team["headers"], issue, body=b"<x/>", name=name)
    assert response.status_code == 415


# --- ranges ------------------------------------------------------------------


@pytest.fixture
def log(client, team):
    issue = make_issue(client, team)
    return attach(client, team, issue, body=b"0123456789abcdef", name="server.log")


def fetch(client, team, log, range_header=None):
    headers = dict(team["headers"])
    if range_header:
        headers["Range"] = range_header
    return client.get(log["url"], headers=headers)


def test_a_whole_file_says_ranges_are_welcome(client, team, log):
    response = fetch(client, team, log)
    assert response.status_code == 200
    assert response.headers["accept-ranges"] == "bytes"
    assert response.content == b"0123456789abcdef"


def test_the_start_of_a_file(client, team, log):
    """What a text preview asks for: the first megabyte, or all of a small file."""
    response = fetch(client, team, log, "bytes=0-9")
    assert response.status_code == 206
    assert response.content == b"0123456789"
    assert response.headers["content-range"] == "bytes 0-9/16"
    assert response.headers["content-length"] == "10"


def test_a_range_past_the_end_is_clamped(client, team, log):
    response = fetch(client, team, log, "bytes=0-1048575")
    assert response.status_code == 206
    assert response.content == b"0123456789abcdef"
    assert response.headers["content-range"] == "bytes 0-15/16"


def test_an_open_range_and_a_suffix(client, team, log):
    assert fetch(client, team, log, "bytes=10-").content == b"abcdef"
    assert fetch(client, team, log, "bytes=-3").content == b"def"


def test_a_range_starting_past_the_end_is_416(client, team, log):
    response = fetch(client, team, log, "bytes=99-")
    assert response.status_code == 416
    assert response.headers["content-range"] == "bytes */16"
    assert response.json()["code"] == "range_not_satisfiable"


@pytest.mark.parametrize(
    "header", ["bytes=0-1,4-5", "items=0-5", "bytes=5-2", "nonsense"]
)
def test_what_it_cannot_serve_as_a_range_it_serves_whole(client, team, log, header):
    """The spec allows answering a range request with the full body."""
    response = fetch(client, team, log, header)
    assert response.status_code == 200
    assert response.content == b"0123456789abcdef"


def test_parse_range_directly():
    assert parse_range(None, 10) is None
    assert parse_range("bytes=2-4", 10) == (2, 4)
    assert parse_range("bytes=-20", 10) == (0, 9)
    with pytest.raises(ApiError):
        parse_range("bytes=10-", 10)
    with pytest.raises(ApiError):
        parse_range("bytes=-0", 10)


class _NoSeek(io.RawIOBase):
    """A stream like S3's: readable, not seekable."""

    def __init__(self, data: bytes):
        self._inner = io.BytesIO(data)

    def readable(self):
        return True

    def read(self, size=-1):
        return self._inner.read(size)

    def seek(self, *_args):
        raise OSError("not seekable")


def test_a_range_is_read_from_a_stream_that_cannot_seek():
    chunks = copy_range(_NoSeek(b"0123456789"), 3, 4, chunk_size=2)
    assert b"".join(chunks) == b"3456"
