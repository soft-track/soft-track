from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ApiTokenCreate(BaseModel):
    #: What it is for -- "nightly export", "CI" -- so the list says which to revoke.
    name: str = Field(min_length=1, max_length=80)
    #: Null or omitted: it never expires.
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=366)


class ApiTokenRead(BaseModel):
    id: int
    name: str
    #: "softtrack_…Xy3Q" -- enough to recognise, never enough to use.
    hint: str
    created_at: datetime
    last_used_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None


class ApiTokenCreated(ApiTokenRead):
    """Returned once, when the token is made. The only time the secret is seen."""

    token: str
