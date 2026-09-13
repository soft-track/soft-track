from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from lib_softtrack.tables import OAuthProvider


class ConnectedIdentity(BaseModel):
    """One provider account that can sign in as the current user.

    Only ever returned for yourself. Which third parties hold a key to an
    account is the account holder's business, and listing somebody else's
    would say which services they use.
    """

    provider: OAuthProvider
    #: The address the provider reported when the connection was made. Shown
    #: so that somebody with a work Google account and a personal one can tell
    #: which of them this is.
    email: Optional[str] = None
    connected_at: datetime
    last_login_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class OAuthExchange(BaseModel):
    """Redeeming a finished sign-in for a session.

    Two halves that travelled separately: the ticket came back in a URL
    fragment, and the handshake never left the tab that started the sign-in.
    Either one alone is worth nothing, which is what stops a link somebody was
    sent from signing them into the sender's account.
    """

    ticket: str = Field(min_length=1, max_length=4096)
    handshake: str = Field(min_length=1, max_length=256)


class OAuthLinkTicket(BaseModel):
    """Permission for one signed-in person to *begin* attaching one provider."""

    ticket: str


class OAuthLink(BaseModel):
    """Finishing a connect: the result the callback handed back.

    Spent with a bearer token for the same account, which is what keeps the
    ticket that opened the round trip from being a credential of its own.
    """

    ticket: str = Field(min_length=1, max_length=4096)


class OAuthLinked(BaseModel):
    """Which provider was just attached, so the page can say so."""

    provider: OAuthProvider
