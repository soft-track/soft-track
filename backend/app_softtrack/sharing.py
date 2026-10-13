from typing import Optional

from fastapi import APIRouter, Depends, Header, Request, Response
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_user
from lib_softtrack import attachments as attachments_service
from lib_softtrack import sharing as sharing_service
from lib_softtrack.models.sharing import (
    ShareLinkCreate,
    ShareLinkCreated,
    ShareLinkRead,
    SharedPage,
)
from lib_softtrack.storage import ObjectNotFound, Storage, copy_stream, get_storage
from lib_softtrack.tables import User
from lib_utils.errors import ErrorCode, api_error
from lib_utils.rate_limit import address_of
from web import get_session

router = APIRouter(tags=["sharing"])

#: Sent with everything a share link serves: nothing behind one belongs in a
#: search engine, whoever pastes the link where a crawler can see it.
NOINDEX = {"X-Robots-Tag": "noindex, nofollow"}


@router.post(
    "/teams/{team_id}/share-links",
    response_model=ShareLinkCreated,
    dependencies=[team_writer],
)
def create_share_link(
    team_id: int,
    payload: ShareLinkCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """A read-only link to an epic or a saved view (#245). Team admins only.
    The token is in this response and nowhere else, ever."""
    return sharing_service.create_link(session, current_user, team_id, payload)


@router.get("/teams/{team_id}/share-links", response_model=list[ShareLinkRead])
def list_share_links(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return sharing_service.list_links(session, current_user, team_id)


@router.delete(
    "/share-links/{share_link_id}", status_code=204, dependencies=[team_writer]
)
def revoke_share_link(
    share_link_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Stop a link working. The row stays, for the team's list."""
    sharing_service.revoke_link(session, current_user, share_link_id)


@router.get("/shared/{token}", response_model=SharedPage)
def open_shared_page(
    token: str,
    request: Request,
    response: Response,
    password: Optional[str] = Header(None, alias="X-Share-Password"),
    session: Session = Depends(get_session),
):
    """The page a share link opens, for anybody holding it: no sign-in.

    A password, when the link asks for one, comes in `X-Share-Password` --
    a header rather than the URL, which ends up in logs and history.
    """
    response.headers.update(NOINDEX)
    return sharing_service.open_page(session, token, password, address_of(request))


@router.get("/shared/{token}/attachments/{attachment_id}")
def download_shared_attachment(
    token: str,
    attachment_id: int,
    request: Request,
    password: Optional[str] = Header(None, alias="X-Share-Password"),
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
):
    """A file on a ticket the link shows, when the link shows files."""
    attachment = sharing_service.shared_attachment(
        session, token, password, address_of(request), attachment_id
    )
    try:
        body = storage.open(attachment.storage_key)
    except ObjectNotFound:
        raise api_error(
            status_code=410,
            code=ErrorCode.attachment_gone,
            detail="That file is no longer stored.",
        )
    return StreamingResponse(
        copy_stream(body),
        media_type=attachments_service.served_type(attachment),
        headers={
            **NOINDEX,
            "Content-Disposition": attachments_service.content_disposition(attachment),
            "Content-Length": str(attachment.size_bytes),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )
