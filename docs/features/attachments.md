# Attachments

Files go on an issue or on one of its comments — paste a screenshot into the
description or the comment box, drop it in, or use **Attach**. Images render
inline. PDFs and text files — logs, Markdown, CSV, JSON, patches, source code —
open in a preview; everything else is a download.

**Where the bytes go.** The metadata is a database row; the file itself is
not. `ATTACHMENT_STORAGE` picks the backend:

| Setting | Where files live | Extra install |
| --- | --- | --- |
| `local` (default) | under `ATTACHMENT_DIR` | none |
| `s3` | any S3-compatible bucket — AWS, MinIO, Ceph, R2, Spaces | `pip install boto3` |

Under Docker, `ATTACHMENT_DIR` is `/data/attachments` on the `softtrack-files`
volume, so a rebuilt container keeps them. For S3, set `ATTACHMENT_S3_BUCKET`
(plus `ATTACHMENT_S3_ENDPOINT_URL` for anything that is not AWS) and leave
credentials to boto3's usual chain — they are deliberately not settings of this
app, so there is one fewer place for a key to end up in a config file. Adding
another backend means implementing three methods; see
`backend/lib_softtrack/storage.py`.

**What is accepted.** Images (PNG/JPEG/GIF/WebP), PDFs, plain text and logs,
CSV/JSON/Markdown, patches, common source and config files (`.py`, `.ts`,
`.go`, `.yaml` and the like), zips, and MP4/WebM/MOV, up to
`ATTACHMENT_MAX_BYTES` (25 MB by default). Anything else is refused with a 415
naming what would have worked.

Three things about that list are deliberate:

- **The served content type comes from the file's extension, not from the
  upload.** A stored file that is served back as `text/html` because the
  uploader said so is a stored cross-site scripting bug, so the type is looked
  up in an allowlist and everything is sent with `X-Content-Type-Options:
  nosniff` and a `default-src 'none'; sandbox` CSP. **Text of every kind is
  served as `text/plain; charset=utf-8`** — Markdown, JSON and source code
  included — because plain text is the one type a browser only ever
  displays; the filename still says what the file is.
- **SVG, HTML and XML are not accepted**, nor are shell scripts. An SVG is a
  document that can carry script, and the only safe way to serve one is as a
  download — which is not the inline diagram anyone wanted.
- **Images and PDFs are checked against their magic bytes.** Not a security
  control — the two above are — but a `.png` that is not a PNG should fail at
  upload with a sentence rather than later as a silently broken preview.

**Downloading needs the same token as everything else**, so a bare `<img src>`
cannot fetch one: the browser sends no `Authorization` header. The frontend
loads image bytes through the API client and renders them as blob URLs. Putting
a token in the URL instead would write a credential into every description that
embeds a screenshot, and into every log line that records the request.

**Previews are rendered from memory, and that is where their safety lives.**
A PDF's bytes become a blob that is always typed `application/pdf` —
whatever the response said — and open in the browser's own viewer. A blob URL
runs with the app's origin, so typing it from a response would let a file
served as `text/html` run as the app. Text is decoded and put on the page as
text, never as markup. A text preview fetches only the first megabyte, with a
`Range` request, and says the file is truncated when it is; the download is
always the whole file. The content endpoint answers single byte ranges with
`206 Partial Content` and ignores anything more elaborate, which the HTTP spec
allows.

Deleting an issue deletes its attachments, rows and bytes both. The rows go
first and the bytes after the commit: an orphaned file costs disk, while an
orphaned row costs a broken image on somebody's issue.
