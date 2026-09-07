from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from lib_identity.models.identity import UserPublic


class AttachmentRead(BaseModel):
    id: int
    issue_id: int
    #: Set once a comment has claimed this file. Null means it belongs to the
    #: issue itself -- typically embedded in the description.
    comment_id: Optional[int] = None
    filename: str
    content_type: str
    size_bytes: int
    #: Whether the browser can be trusted to render this inline. Saves every
    #: caller from keeping its own list of image types in sync with the
    #: server's.
    is_image: bool
    #: Where the bytes are, relative to the API root. Relative on purpose: it
    #: is what gets written into markdown, and an absolute URL would bake this
    #: deployment's hostname into the issue text forever.
    url: str
    uploaded_by: UserPublic
    created_at: datetime

    class Config:
        from_attributes = True
