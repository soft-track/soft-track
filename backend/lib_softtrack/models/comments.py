from datetime import datetime

from typing import Optional

from pydantic import BaseModel, Field

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.attachments import AttachmentRead


class CommentCreate(BaseModel):
    body: str = Field(min_length=1)
    #: Attachments uploaded against this issue while the comment was being
    #: written. They are claimed on submit rather than uploaded with the
    #: comment, because a screenshot is pasted before there is a comment for
    #: it to belong to. Only unclaimed files on this issue are accepted.
    attachment_ids: list[int] = []


class CommentRead(BaseModel):
    id: int
    issue_id: int
    body: str
    #: Null when an automation rule wrote it -- see `Comment.author_id`.
    #: The client renders those as the rule that posted them rather than
    #: as a person.
    author: Optional[UserPublic]
    attachments: list[AttachmentRead] = []
    created_at: datetime

    class Config:
        from_attributes = True
