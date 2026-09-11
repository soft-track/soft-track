from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str
    #: Blank means "derive one from the address"; see lib_identity/usernames.py.
    username: Optional[str] = None
    #: Present when the person arrived through an invitation link, so the
    #: account lands in the team instead of nowhere.
    invite_token: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    id: int
    email: str
    username: str
    full_name: str
    avatar_color: str
    #: Shown as a "Deactivated" badge on rosters, and used to keep deactivated
    #: people out of assignee pickers without hiding work already assigned.
    is_active: bool

    class Config:
        from_attributes = True


class UserMe(UserPublic):
    """The signed-in user's own record.

    A superset of UserPublic rather than a separate model: what the account
    can do instance-wide is the user's business, and nobody else's, so it is
    only ever returned for `me`.
    """

    is_site_admin: bool
    created_at: datetime


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    username: Optional[str] = None
    avatar_color: Optional[str] = None
    email: Optional[EmailStr] = None
    #: Required only when `email` changes. An address is the identity a
    #: password reset would one day be sent to, so changing it is re-verified
    #: even though the session is already authenticated.
    current_password: Optional[str] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class AuthConfig(BaseModel):
    """What the sign-in pages need to know before anyone has authenticated."""

    open_registration: bool
    #: Whether / shows the landing page to a signed-out visitor, or redirects
    #: to the sign-in form the way it did before there was one.
    landing_page: bool
    #: Whether this instance is seeded with the published demo account, and so
    #: may prefill its address and print its password under the sign-in button.
    demo_credentials: bool


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserMe
