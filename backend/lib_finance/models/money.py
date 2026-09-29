"""Schemas shared by every finance response.

Everything under lib_finance/models is a finance schema: returned by finance
endpoints and nothing else (#130). A profile, directory or admin model never
imports one, so a field added here cannot ride out on a response that anyone
signed in can read -- tests/test_finance_access.py checks the whole API for it.
"""

from typing import Optional

from pydantic import BaseModel, ConfigDict

from lib_finance.money import Currency
from lib_identity.models.departments import DepartmentRef


class CurrencyRead(BaseModel):
    """A currency amounts can be recorded in, and its decimal places."""

    code: Currency
    #: 2 for USD (cents), 0 for JPY, 3 for KWD: what an amount in minor units
    #: is divided by, as a power of ten, to show it.
    minor_units: int


class FinancePerson(BaseModel):
    """Who a finance row is about: enough to show them and find them."""

    id: int
    username: str
    full_name: str
    avatar_color: str
    is_active: bool
    job_title: Optional[str] = None
    department: Optional[DepartmentRef] = None

    model_config = ConfigDict(from_attributes=True)
