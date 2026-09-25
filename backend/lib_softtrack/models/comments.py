from datetime import datetime

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.attachments import AttachmentRead
from lib_softtrack.tables import ReactionEmoji


class CommentCreate(BaseModel):
    body: str = Field(min_length=1)
    #: Attachments uploaded against this issue while the comment was being
    #: written. They are claimed on submit rather than uploaded with the
    #: comment, because a screenshot is pasted before there is a comment for
    #: it to belong to. Only unclaimed files on this issue are accepted.
    attachment_ids: list[int] = []


class CommentUpdate(BaseModel):
    """A new body for a comment (#93). The body is the only thing that changes:
    its files stay as they were posted, and removing one is done on the file."""

    body: str = Field(min_length=1)


class ReactionSummary(BaseModel):
    """One emoji on one comment, and who gave it (#96).

    Summarised rather than one row per reaction: a chip needs the count, the
    names for its tooltip, and whether it is yours to take back -- never the
    individual rows.
    """

    emoji: ReactionEmoji
    count: int
    #: Whether the person asking is one of `users`.
    reacted: bool
    #: In the order they reacted.
    users: list[UserPublic]


class CommentRead(BaseModel):
    id: int
    issue_id: int
    body: str
    #: Null when an automation rule wrote it -- see `Comment.author_id`.
    #: The client renders those as the rule that posted them rather than
    #: as a person.
    author: Optional[UserPublic]
    attachments: list[AttachmentRead] = []
    #: Only the emoji somebody used, in the fixed order of `ReactionEmoji`.
    reactions: list[ReactionSummary] = []
    created_at: datetime
    #: When the body was last edited, or null if it never was (#93).
    edited_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
