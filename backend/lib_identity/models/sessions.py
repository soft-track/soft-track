from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class SessionRead(BaseModel):
    """One place the account is signed in (#308)."""

    id: int
    #: "Firefox", "Safari" -- read from the User-Agent header, or null when
    #: it says nothing recognisable.
    browser: Optional[str] = None
    #: "Linux", "iPhone" -- the same, for the system.
    system: Optional[str] = None
    ip_address: str
    created_at: datetime
    last_used_at: datetime
    #: The session this request was made with: "this device".
    current: bool
