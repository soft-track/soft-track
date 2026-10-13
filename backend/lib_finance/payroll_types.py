"""Which employment types are on payroll (#320).

Who is on payroll comes from the employment type (#247): an account with no
type, or an employee, is on it. A contractor, an intern or a service account
is on it only when finance switches that type on, kept in
`InstanceSettings.payroll_types`. An account from outside the organisation --
`is_external`, or typed external -- is never on payroll, whatever pay is
recorded for it (#243).

`lib_finance.compensation.on_payroll` builds on these for the draft runs, the
runs' left-off list and the Compensation list, so the three cannot disagree.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Session, and_, col, or_

from lib_softtrack.tables import EmploymentType, InstanceSettings, User

_SETTINGS_ID = 1

#: The types finance may put on payroll, in the order they are shown.
#: Employees always are; external never is.
SWITCHABLE = (
    EmploymentType.contractor,
    EmploymentType.intern,
    EmploymentType.service_account,
)


def switched_on(session: Session) -> list[EmploymentType]:
    """The types finance has put on payroll besides employees."""
    stored = session.get(InstanceSettings, _SETTINGS_ID)
    kept = set(stored.payroll_types) if stored else set()
    return [kind for kind in SWITCHABLE if kind.value in kept]


def switch_on(session: Session, kinds: list[EmploymentType]) -> list[EmploymentType]:
    """Replace the types on payroll besides employees. The caller has refused
    anything outside `SWITCHABLE`."""
    stored = session.get(InstanceSettings, _SETTINGS_ID)
    if stored is None:
        stored = InstanceSettings(id=_SETTINGS_ID)
    wanted = set(kinds)
    stored.payroll_types = [kind.value for kind in SWITCHABLE if kind in wanted]
    stored.updated_at = datetime.now(timezone.utc)
    session.add(stored)
    session.commit()
    return switched_on(session)


def outside():
    """From outside the organisation: the access flag, or the type."""
    return or_(
        User.is_external == True,  # noqa: E712 -- SQL comparison
        User.employment_type == EmploymentType.external,
    )


def inside():
    """`not outside()`, spelled so that a null type is never a null answer."""
    return and_(
        User.is_external == False,  # noqa: E712 -- SQL comparison
        or_(
            col(User.employment_type).is_(None),
            User.employment_type != EmploymentType.external,
        ),
    )


def on_payroll_by_type(session: Session):
    """Inside the organisation, and of a type that is on payroll."""
    kinds = [EmploymentType.employee, *switched_on(session)]
    return and_(
        inside(),
        or_(
            col(User.employment_type).is_(None),
            col(User.employment_type).in_(kinds),
        ),
    )


def left_off_reason(
    is_external: bool, employment_type: Optional[EmploymentType]
) -> EmploymentType:
    """Why an account is not on payroll, as the type that keeps it off."""
    if is_external or employment_type is EmploymentType.external:
        return EmploymentType.external
    # Not outside and not on payroll, so it has a type that is switched off.
    return employment_type or EmploymentType.employee
