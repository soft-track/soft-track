from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field

from lib_identity.models.identity import UserMe


class AdminUserRead(UserMe):
    """A row in the site admin's user directory."""

    last_login_at: Optional[datetime] = None
    #: How many teams the account belongs to. Enough to tell an active
    #: colleague from a stale invite-era account without opening every team.
    team_count: int


class AdminUserUpdate(BaseModel):
    is_active: Optional[bool] = None
    is_site_admin: Optional[bool] = None
    full_name: Optional[str] = None
    #: When they started (#122). An explicit null clears it; leaving it out
    #: leaves it alone. Set here and nowhere else: it is the organisation's
    #: fact, so the person cannot change it from their own profile.
    started_on: Optional[date] = None


class AdminPasswordReset(BaseModel):
    new_password: str = Field(min_length=8)
