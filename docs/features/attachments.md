# Attachments

Files go on an issue or on one of its comments — paste a screenshot into the
description or the comment box, drop it in, or use **Attach**. Images render
inline; everything else becomes a download link.

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
CSV/JSON/Markdown, patches, zips, and MP4/WebM/MOV, up to
`ATTACHMENT_MAX_BYTES` (25 MB by default). Anything else is refused with a 415
naming what would have worked.

Three things about that list are deliberate:

- **The served content type comes from the file's extension, not from the
  upload.** A stored file that is served back as `text/html` because the
  uploader said so is a stored cross-site scripting bug, so the type is looked
  up in an allowlist and everything is sent with `X-Content-Type-Options:
  nosniff` and a `default-src 'none'` CSP.
- **SVG is not accepted**, even though it is an image. An SVG is a document
  that can carry script, and the only safe way to serve one is as a download —
  which is not the inline diagram anyone wanted.
- **Images are checked against their magic bytes.** Not a security control
  — the two above are — but a `.png` that is not a PNG should fail at upload
  with a sentence rather than later as a silently broken image.

**Downloading needs the same token as everything else**, so a bare `<img src>`
cannot fetch one: the browser sends no `Authorization` header. The frontend
loads image bytes through the API client and renders them as blob URLs. Putting
a token in the URL instead would write a credential into every description that
embeds a screenshot, and into every log line that records the request.

Deleting an issue deletes its attachments, rows and bytes both. The rows go
first and the bytes after the commit: an orphaned file costs disk, while an
orphaned row costs a broken image on somebody's issue.
