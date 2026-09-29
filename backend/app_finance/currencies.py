from fastapi import APIRouter, Depends

from lib_finance.models.money import CurrencyRead
from lib_finance.money import MINOR_UNITS
from lib_identity.identity import get_current_user
from lib_softtrack.tables import User

router = APIRouter(prefix="/currencies", tags=["currencies"])


@router.get("", response_model=list[CurrencyRead])
def list_currencies(_: User = Depends(get_current_user)):
    """Every currency an amount can be recorded in, and its decimal places.

    Open to anyone signed in: a list of currencies is no secret, and the
    browser converts "8,300.00" to minor units with it rather than keeping a
    copy of its own that could disagree.
    """
    return [
        CurrencyRead(code=code, minor_units=units)
        for code, units in MINOR_UNITS.items()
    ]
