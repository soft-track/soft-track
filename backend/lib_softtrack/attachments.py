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
gone costs a broken image on somebody's ticket. Only one of those is worth
risking.
"""

import logging
import secrets
from collections.abc import Mapping
from pathlib import PurePosixPath
from typing import Optional
from urllib.parse import quote

from fastapi import UploadFile
from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.attachments import AttachmentPreview, AttachmentRead
from lib_softtrack.storage import ObjectNotFound, Storage
from lib_softtrack.tables import Attachment, Comment, TeamRole, Ticket, User
from lib_softtrack.teams import require_team_commenter, require_team_member
from lib_utils.errors import ErrorCode, api_error

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
    # Source and config files (#101), stored and served as plain text -- the
    # one type a browser will never execute or render as markup. `.html`,
    # `.svg` and `.xml` stay out: plain text is the only way they could be
    # served safely, and then a preview is not what anybody uploaded them for.
    **{
        extension: "text/plain"
        for extension in (
            ".py",
            ".js",
            ".jsx",
            ".ts",
            ".tsx",
            ".go",
            ".rs",
            ".java",
            ".kt",
            ".rb",
            ".php",
            ".c",
            ".h",
            ".cpp",
            ".cs",
            ".swift",
            ".sql",
            ".css",
            ".yaml",
            ".yml",
            ".toml",
            ".ini",
            ".cfg",
        )
    },
    ".zip": "application/zip",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
}

#: The types rendered inline rather than downloaded. Every one is an image
#: format a browser decodes as an image and nothing else.
IMAGE_TYPES = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})

#: Types previewed as text (#101). Every one of them is *served* as
#: `text/plain` whatever it is stored as -- see `served_type`.
TEXT_TYPES = frozenset({"text/plain", "text/markdown", "text/csv", "application/json"})

#: What a text preview is served as: plain, UTF-8, and never anything a
#: browser renders as markup.
PLAIN_TEXT = "text/plain; charset=utf-8"

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

#: Where a PDF's header may sit. The format allows junk before it and readers
#: tolerate up to a kilobyte of it, so the check does too.
_PDF_HEADER_WINDOW = 1024

#: Long enough that a name is still recognisable, short enough that it cannot
#: be used to bloat a row or a response header.
MAX_FILENAME_LENGTH = 200

#: Longest extension in ALLOWED_TYPES, used when shortening a long name.
MAX_EXTENSION_LENGTH = max(len(extension) - 1 for extension in ALLOWED_TYPES)


def content_type_for(
    filename: str, allowed: Mapping[str, str] = ALLOWED_TYPES
) -> Optional[str]:
    """The type this name will be served as, or None if it is not allowed."""
    return allowed.get(PurePosixPath(filename).suffix.lower())


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


def new_storage_key(filename: str) -> str:
    """A fresh, unguessable key, sharded so no directory grows without bound."""
    token = secrets.token_hex(16)
    return f"{token[:2]}/{token}{PurePosixPath(filename).suffix.lower()}"


def check_upload(
    raw_filename: str, data: bytes, allowed: Mapping[str, str] = ALLOWED_TYPES
) -> tuple[str, str]:
    """A file fit to store: its safe name and the type it will be served as.

    Refused, with the reason, when it has no usable name, a type not on
    `allowed`, no bytes, or bytes that are not the image or PDF its name
    says. Shared with expense receipts (#133), which allow fewer types.
    """
    filename = safe_filename(raw_filename)
    if not filename:
        raise api_error(
            status_code=422,
            code=ErrorCode.attachment_name_missing,
            detail="That file has no usable name.",
        )

    content_type = content_type_for(filename, allowed)
    if content_type is None:
        raise api_error(
            status_code=415,
            code=ErrorCode.attachment_type_not_allowed,
            detail=(
                f"{PurePosixPath(filename).suffix or 'That file type'} is not an "
                "accepted attachment type. Accepted: "
                + ", ".join(sorted(allowed))
                + "."
            ),
        )

    if not data:
        raise api_error(
            status_code=422, code=ErrorCode.file_empty, detail="That file is empty."
        )

    signatures = _IMAGE_SIGNATURES.get(content_type)
    not_a_pdf = (
        content_type == "application/pdf" and b"%PDF-" not in data[:_PDF_HEADER_WINDOW]
    )
    if (signatures and not data.startswith(signatures)) or not_a_pdf:
        raise api_error(
            status_code=422,
            code=ErrorCode.attachment_content_mismatch,
            detail=f"{filename} is not a valid {content_type.split('/')[1].upper()}.",
        )
    return filename, content_type


def preview_kind(content_type: str) -> Optional[AttachmentPreview]:
    """How the client may show this file without downloading it, if at all."""
    if content_type in IMAGE_TYPES:
        return AttachmentPreview.image
    if content_type == "application/pdf":
        return AttachmentPreview.pdf
    if content_type in TEXT_TYPES:
        return AttachmentPreview.text
    return None


def served_type(attachment: Attachment) -> str:
    """The Content-Type the bytes go out with.

    The stored type for everything except text, which always goes out as
    `text/plain; charset=utf-8`. A Markdown or JSON file served as itself is
    something a browser may decide to render; plain text is the one type it
    only ever displays. The filename still says what the file is.
    """
    if preview_kind(attachment.content_type) == AttachmentPreview.text:
        return PLAIN_TEXT
    return attachment.content_type


def content_disposition(attachment: Attachment) -> str:
    return content_disposition_for(attachment.filename, attachment.content_type)


def content_disposition_for(name: str, content_type: str) -> str:
    """`inline` for what can be previewed, `attachment` for everything else.

    Both spellings of the filename are sent: the bare `filename=` for clients
    that predate RFC 5987 and `filename*=` for every name that is not ASCII,
    which is most people's names for most files.
    """
    disposition = "inline" if preview_kind(content_type) else "attachment"
    ascii_name = name.encode("ascii", "replace").decode("ascii").replace('"', "'")
    return (
        f'{disposition}; filename="{ascii_name}"; '
        f"filename*=UTF-8''{quote(name, safe='')}"
    )


def to_read(attachment: Attachment, uploader: User) -> AttachmentRead:
    return AttachmentRead(
        id=attachment.id,
        ticket_id=attachment.ticket_id,
        comment_id=attachment.comment_id,
        filename=attachment.filename,
        content_type=attachment.content_type,
        size_bytes=attachment.size_bytes,
        is_image=attachment.content_type in IMAGE_TYPES,
        preview=preview_kind(attachment.content_type),
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


def _ticket_or_404(session: Session, ticket_id: int) -> Ticket:
    ticket = session.get(Ticket, ticket_id)
    if ticket is None:
        raise api_error(
            status_code=404, code=ErrorCode.ticket_not_found, detail="Ticket not found"
        )
    return ticket


def get_attachment_for_read(
    session: Session, current_user: User, attachment_id: int
) -> Attachment:
    """An attachment the caller is allowed to see, or 404/403.

    The ticket is the only route to a team, which is why every attachment has
    one even when a comment owns it.
    """
    attachment = session.get(Attachment, attachment_id)
    if attachment is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.attachment_not_found,
            detail="Attachment not found",
        )
    ticket = _ticket_or_404(session, attachment.ticket_id)
    require_team_member(ticket.team_id, current_user, session)
    return attachment


def create_attachment(
    session: Session,
    storage: Storage,
    current_user: User,
    ticket_id: int,
    upload: UploadFile,
    data: bytes,
) -> AttachmentRead:
    """Store an uploaded file against a ticket.

    `data` is read by the router, which is where the size limit is enforced --
    a limit is only worth anything if it is applied before the whole body is
    in hand.
    """
    ticket = _ticket_or_404(session, ticket_id)
    # A guest of a team that lets its guests comment uploads for a comment
    # (#244); nobody else who only reads may upload at all.
    membership = require_team_commenter(ticket.team_id, current_user, session)

    filename, content_type = check_upload(upload.filename or "", data)

    key = new_storage_key(filename)
    # Bytes first: a row promising a file that was never written is the one
    # failure that shows up as a broken image rather than as an error.
    storage.write(key, data)

    attachment = Attachment(
        ticket_id=ticket_id,
        filename=filename,
        content_type=content_type,
        size_bytes=len(data),
        storage_key=key,
        uploaded_by_id=current_user.id,
        guest_draft=membership.role == TeamRole.guest,
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


def list_for_ticket(
    session: Session, current_user: User, ticket_id: int
) -> list[AttachmentRead]:
    """The ticket's own files -- the ones no comment has claimed.

    Comment attachments come back on the comment, so each file has exactly one
    place it is listed and the UI never has to dedupe.
    """
    ticket = _ticket_or_404(session, ticket_id)
    require_team_member(ticket.team_id, current_user, session)

    attachments = session.exec(
        select(Attachment)
        .where(
            Attachment.ticket_id == ticket_id,
            Attachment.comment_id.is_(None),
            # A guest uploads only for a comment (#244), so a file of theirs
            # no comment has claimed yet is a draft, not the ticket's.
            Attachment.guest_draft.is_(False),
        )
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
    session: Session,
    comment: Comment,
    attachment_ids: list[int],
    uploaded_by: Optional[int] = None,
) -> None:
    """Hand a comment the files that were uploaded while it was being written.

    Only unclaimed attachments on the same ticket can be claimed, so a comment
    cannot adopt a file out of someone else's comment or off another ticket and
    thereby carry it somewhere the uploader never put it. With `uploaded_by`,
    only that person's files: a guest's comment cannot take the ticket's own
    (#244).
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
            or attachment.ticket_id != comment.ticket_id
            or attachment.comment_id is not None
            or (uploaded_by is not None and attachment.uploaded_by_id != uploaded_by)
        ):
            raise api_error(
                status_code=400,
                code=ErrorCode.attachment_not_attachable,
                detail=f"Attachment {attachment_id} cannot be attached to this comment.",
            )
        attachment.comment_id = comment.id
        session.add(attachment)


def delete_attachment(
    session: Session, storage: Storage, current_user: User, attachment_id: int
) -> None:
    attachment = get_attachment_for_read(session, current_user, attachment_id)
    ticket = session.get(Ticket, attachment.ticket_id)
    membership = require_team_commenter(ticket.team_id, current_user, session)
    # A guest who may comment removes the files they uploaded, and no others
    # (#244): a draft's file taken back before sending, or one on a comment
    # of their own.
    if (
        membership.role == TeamRole.guest
        and attachment.uploaded_by_id != current_user.id
    ):
        raise api_error(
            status_code=403,
            code=ErrorCode.not_your_attachment,
            detail="Guests can remove only the files they attached",
        )
    key = attachment.storage_key
    session.delete(attachment)
    session.commit()
    purge(storage, [key])


def take_keys_for_ticket(session: Session, ticket_id: int) -> list[str]:
    """Delete a ticket's attachment rows, returning the keys still to purge.

    Called while deleting a ticket. The rows go now, inside the caller's
    transaction; the bytes go after it commits, which is why the keys come
    back rather than being deleted here.
    """
    attachments = session.exec(
        select(Attachment).where(Attachment.ticket_id == ticket_id)
    ).all()
    keys = [attachment.storage_key for attachment in attachments]
    for attachment in attachments:
        session.delete(attachment)
    return keys


def take_keys_for_comment(session: Session, comment_id: int) -> list[str]:
    """Delete a comment's attachment rows, returning the keys still to purge.

    Called while deleting a comment (#93), for the reasons and in the order
    `take_keys_for_ticket` gives: rows now, bytes after the commit.
    """
    attachments = session.exec(
        select(Attachment).where(Attachment.comment_id == comment_id)
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
