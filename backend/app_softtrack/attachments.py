from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack import attachments as attachments_service
from lib_softtrack.models.attachments import AttachmentRead
from lib_softtrack.storage import ObjectNotFound, Storage, copy_stream, get_storage
from lib_softtrack.tables import User
from web import get_session, settings

router = APIRouter(tags=["attachments"])


@router.post("/issues/{issue_id}/attachments", response_model=AttachmentRead)
async def upload_attachment(
    issue_id: int,
    file: UploadFile = File(..., description="The file to attach."),
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    current_user: User = Depends(get_current_user),
):
    """Attach a file to an issue.

    The file starts out belonging to the issue. Posting a comment with its id
    in `attachment_ids` moves it to that comment -- which is the order the
    interface needs, because a screenshot is pasted before the sentence about
    it is written.
    """
    limit = settings.attachment_max_bytes
    # Read one byte past the limit: enough to know the file is too big, and
    # not enough for an oversized upload to be worth sending.
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            status_code=413,
            detail=f"That file is larger than {limit // (1024 * 1024)}MB.",
        )

    return attachments_service.create_attachment(
        session, storage, current_user, issue_id, file, data
    )


@router.get("/issues/{issue_id}/attachments", response_model=list[AttachmentRead])
def list_issue_attachments(
    issue_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Files attached to the issue itself.

    Files belonging to a comment are returned with that comment instead, so
    nothing appears twice.
    """
    return attachments_service.list_for_issue(session, current_user, issue_id)


@router.get("/attachments/{attachment_id}/content")
def download_attachment(
    attachment_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    current_user: User = Depends(get_current_user),
):
    """The bytes.

    Authenticated like every other route, which means an `<img src>` cannot
    fetch it directly -- the browser sends no Authorization header. The
    frontend loads images through the API client and renders the result as a
    blob URL. The alternative, a token in the URL, would put a credential into
    every issue description that embeds an image and into every log line that
    records the request.
    """
    attachment = attachments_service.get_attachment_for_read(
        session, current_user, attachment_id
    )
    try:
        body = storage.open(attachment.storage_key)
    except ObjectNotFound:
        # The row promised bytes that are not there. That is a real failure,
        # but retrying cannot fix it, so say so with a status that means gone.
        raise HTTPException(status_code=410, detail="That file is no longer stored.")

    return StreamingResponse(
        copy_stream(body),
        media_type=attachment.content_type,
        headers={
            "Content-Length": str(attachment.size_bytes),
            "Content-Disposition": attachments_service.content_disposition(attachment),
            # The stored type is the only type this file is ever served as;
            # nosniff stops a browser deciding otherwise from the content.
            "X-Content-Type-Options": "nosniff",
            # Belt and braces for anything that does get rendered: no script,
            # no subresources, no navigation.
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


@router.delete("/attachments/{attachment_id}", status_code=204)
def delete_attachment(
    attachment_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    current_user: User = Depends(get_current_user),
):
    """Remove an attachment and its bytes.

    Any member of the team may, which matches how the rest of the app treats
    issues and comments: membership is the boundary, and there is no
    per-object ownership anywhere else to be consistent with.
    """
    attachments_service.delete_attachment(session, storage, current_user, attachment_id)
