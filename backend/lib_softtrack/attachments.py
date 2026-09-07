"""Attachment services: accepting a file, serving it back, and cleaning up.

Two decisions run through the whole module.

**The content type is derived, never accepted.** A multipart part carries
whatever Content-Type the client felt like sending, and a stored file that is
served back as `text/html` is a stored cross-site scripting bug. So the type
comes from an allowlist keyed on the extension, and files whose extension is
not on the list are refused outright rather than stored as
`application/octet-stream`.

**Deletion goes row first, bytes after the commit.** The two orders fail
differently: a blob whose row is gone costs disk, while a row whose blob is
gone costs a broken image on somebody's issue. Only one of those is worth
risking.
"""

import logging
import secrets
from pathlib import PurePosixPath
from typing import Optional
from urllib.parse import quote

from fastapi import HTTPException, UploadFile
from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.attachments import AttachmentRead
from lib_softtrack.storage import ObjectNotFound, Storage
from lib_softtrack.tables import Attachment, Comment, Issue, User
from lib_softtrack.teams import require_team_member

logger = logging.getLogger(__name__)

#: Extension -> the type the file will be served back as. Deriving the type
#: from the name is what makes the set of types we serve a closed set: a
#: request cannot talk the server into serving anything that is not a value
#: in this table.
#:
#: `.svg` is deliberately absent. An SVG is a document that can carry script,
#: and the only safe way to serve one is as a download -- at which point it is
#: not the inline diagram anybody wanted. `.html` is absent for the same
#: reason with none of the regret.
ALLOWED_TYPES: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".log": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".patch": "text/plain",
    ".diff": "text/plain",
    ".zip": "application/zip",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
}

#: The types rendered inline rather than downloaded. Every one is an image
#: format a browser decodes as an image and nothing else.
IMAGE_TYPES = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})

#: First bytes each image format must start with. Checked because "screenshot
#: of the bug" is the whole point of this feature and a file that is not
#: actually a PNG will fail as a silent broken image later rather than as a
#: clear error now. It is not a security control -- nosniff and the derived
#: content type are -- it is an error message that arrives at the right time.
_IMAGE_SIGNATURES: dict[str, tuple[bytes, ...]] = {
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/webp": (b"RIFF",),
}

#: Long enough that a name is still recognisable, short enough that it cannot
#: be used to bloat a row or a response header.
MAX_FILENAME_LENGTH = 200

#: Longest extension in ALLOWED_TYPES, used when shortening a long name.
MAX_EXTENSION_LENGTH = max(len(extension) - 1 for extension in ALLOWED_TYPES)


def content_type_for(filename: str) -> Optional[str]:
    """The type this name will be served as, or None if it is not allowed."""
    return ALLOWED_TYPES.get(PurePosixPath(filename).suffix.lower())


def safe_filename(raw: str) -> str:
    """The name with any directory part and control characters removed.

    Never used to build a path -- the storage key is generated -- so this is
    about what is safe to *show* and to put in a Content-Disposition header,
    not about traversal.
    """
    # Windows clients send backslash-separated paths, which PurePosixPath
    # treats as an ordinary character; normalise before taking the last part.
    name = PurePosixPath(raw.replace("\\", "/")).name
    name = "".join(character for character in name if character.isprintable())
    name = name.strip().strip(".")

    if len(name) > MAX_FILENAME_LENGTH:
        # Truncate the stem, not the whole name. Cutting the extension off
        # would change what the file *is* -- the type is derived from it --
        # so a long name would be refused rather than shortened.
        suffix = PurePosixPath(name).suffix[: MAX_EXTENSION_LENGTH + 1]
        name = PurePosixPath(name).stem[: MAX_FILENAME_LENGTH - len(suffix)] + suffix

    return name


def _storage_key(extension: str) -> str:
    """A fresh, unguessable key, sharded so no directory grows without bound."""
    token = secrets.token_hex(16)
    return f"{token[:2]}/{token}{extension}"


def content_disposition(attachment: Attachment) -> str:
    """`inline` for images, `attachment` for everything else.

    Both spellings of the filename are sent: the bare `filename=` for clients
    that predate RFC 5987 and `filename*=` for every name that is not ASCII,
    which is most people's names for most files.
    """
    disposition = "inline" if attachment.content_type in IMAGE_TYPES else "attachment"
    name = attachment.filename
    ascii_name = name.encode("ascii", "replace").decode("ascii").replace('"', "'")
    return (
        f'{disposition}; filename="{ascii_name}"; '
        f"filename*=UTF-8''{quote(name, safe='')}"
    )


def to_read(attachment: Attachment, uploader: User) -> AttachmentRead:
    return AttachmentRead(
        id=attachment.id,
        issue_id=attachment.issue_id,
        comment_id=attachment.comment_id,
        filename=attachment.filename,
        content_type=attachment.content_type,
        size_bytes=attachment.size_bytes,
        is_image=attachment.content_type in IMAGE_TYPES,
        url=f"/attachments/{attachment.id}/content",
        uploaded_by=UserPublic.model_validate(uploader),
        created_at=attachment.created_at,
    )


def _expand(session: Session, attachments: list[Attachment]) -> list[AttachmentRead]:
    """Read models for a list, with one query for the uploaders rather than N."""
    if not attachments:
        return []
    uploader_ids = {attachment.uploaded_by_id for attachment in attachments}
    uploaders = {
        user.id: user
        for user in session.exec(select(User).where(User.id.in_(uploader_ids))).all()
    }
    return [to_read(a, uploaders[a.uploaded_by_id]) for a in attachments]


def _issue_or_404(session: Session, issue_id: int) -> Issue:
    issue = session.get(Issue, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


def get_attachment_for_read(
    session: Session, current_user: User, attachment_id: int
) -> Attachment:
    """An attachment the caller is allowed to see, or 404/403.

    The issue is the only route to a team, which is why every attachment has
    one even when a comment owns it.
    """
    attachment = session.get(Attachment, attachment_id)
    if attachment is None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    issue = _issue_or_404(session, attachment.issue_id)
    require_team_member(issue.team_id, current_user, session)
    return attachment


def create_attachment(
    session: Session,
    storage: Storage,
    current_user: User,
    issue_id: int,
    upload: UploadFile,
    data: bytes,
) -> AttachmentRead:
    """Store an uploaded file against an issue.

    `data` is read by the router, which is where the size limit is enforced --
    a limit is only worth anything if it is applied before the whole body is
    in hand.
    """
    issue = _issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)

    filename = safe_filename(upload.filename or "")
    if not filename:
        raise HTTPException(status_code=422, detail="That file has no usable name.")

    content_type = content_type_for(filename)
    if content_type is None:
        raise HTTPException(
            status_code=415,
            detail=(
                f"{PurePosixPath(filename).suffix or 'That file type'} is not an "
                "accepted attachment type. Accepted: "
                + ", ".join(sorted(ALLOWED_TYPES))
                + "."
            ),
        )

    if not data:
        raise HTTPException(status_code=422, detail="That file is empty.")

    signatures = _IMAGE_SIGNATURES.get(content_type)
    if signatures and not data.startswith(signatures):
        raise HTTPException(
            status_code=422,
            detail=f"{filename} is not a valid {content_type.split('/')[1].upper()}.",
        )

    key = _storage_key(PurePosixPath(filename).suffix.lower())
    # Bytes first: a row promising a file that was never written is the one
    # failure that shows up as a broken image rather than as an error.
    storage.write(key, data)

    attachment = Attachment(
        issue_id=issue_id,
        filename=filename,
        content_type=content_type,
        size_bytes=len(data),
        storage_key=key,
        uploaded_by_id=current_user.id,
    )
    session.add(attachment)
    try:
        session.commit()
    except Exception:
        session.rollback()
        storage.delete(key)
        raise
    session.refresh(attachment)

    return to_read(attachment, current_user)


def list_for_issue(
    session: Session, current_user: User, issue_id: int
) -> list[AttachmentRead]:
    """The issue's own files -- the ones no comment has claimed.

    Comment attachments come back on the comment, so each file has exactly one
    place it is listed and the UI never has to dedupe.
    """
    issue = _issue_or_404(session, issue_id)
    require_team_member(issue.team_id, current_user, session)

    attachments = session.exec(
        select(Attachment)
        .where(Attachment.issue_id == issue_id, Attachment.comment_id.is_(None))
        .order_by(Attachment.created_at, Attachment.id)
    ).all()
    return _expand(session, list(attachments))


def for_comments(
    session: Session, comment_ids: list[int]
) -> dict[int, list[AttachmentRead]]:
    """Attachments for a page of comments, keyed by comment, in one query."""
    if not comment_ids:
        return {}
    attachments = session.exec(
        select(Attachment)
        .where(Attachment.comment_id.in_(comment_ids))
        .order_by(Attachment.created_at, Attachment.id)
    ).all()
    expanded = _expand(session, list(attachments))
    grouped: dict[int, list[AttachmentRead]] = {}
    for read in expanded:
        grouped.setdefault(read.comment_id, []).append(read)
    return grouped


def claim_for_comment(
    session: Session, comment: Comment, attachment_ids: list[int]
) -> None:
    """Hand a comment the files that were uploaded while it was being written.

    Only unclaimed attachments on the same issue can be claimed, so a comment
    cannot adopt a file out of someone else's comment or off another issue and
    thereby carry it somewhere the uploader never put it.
    """
    if not attachment_ids:
        return

    found = {
        attachment.id: attachment
        for attachment in session.exec(
            select(Attachment).where(Attachment.id.in_(set(attachment_ids)))
        ).all()
    }
    for attachment_id in attachment_ids:
        attachment = found.get(attachment_id)
        if (
            attachment is None
            or attachment.issue_id != comment.issue_id
            or attachment.comment_id is not None
        ):
            raise HTTPException(
                status_code=400,
                detail=f"Attachment {attachment_id} cannot be attached to this comment.",
            )
        attachment.comment_id = comment.id
        session.add(attachment)


def delete_attachment(
    session: Session, storage: Storage, current_user: User, attachment_id: int
) -> None:
    attachment = get_attachment_for_read(session, current_user, attachment_id)
    key = attachment.storage_key
    session.delete(attachment)
    session.commit()
    purge(storage, [key])


def take_keys_for_issue(session: Session, issue_id: int) -> list[str]:
    """Delete an issue's attachment rows, returning the keys still to purge.

    Called while deleting an issue. The rows go now, inside the caller's
    transaction; the bytes go after it commits, which is why the keys come
    back rather than being deleted here.
    """
    attachments = session.exec(
        select(Attachment).where(Attachment.issue_id == issue_id)
    ).all()
    keys = [attachment.storage_key for attachment in attachments]
    for attachment in attachments:
        session.delete(attachment)
    return keys


def purge(storage: Storage, keys: list[str]) -> None:
    """Remove bytes whose rows are already gone.

    Failures are logged, not raised. By the time this runs the delete has
    committed and succeeded; turning a storage hiccup into a 500 would tell
    the caller their delete failed when it did not. The cost of getting this
    wrong is an orphaned file, which is a disk-space problem rather than a
    correctness one.
    """
    for key in keys:
        try:
            storage.delete(key)
        except ObjectNotFound:
            pass
        except Exception:  # pragma: no cover -- backend-specific failures
            logger.warning("Could not delete attachment %s from storage", key)
