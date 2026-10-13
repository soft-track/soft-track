"""Manager links (#124): who somebody reports to.

One nullable, self-referencing link on the user, set by a site admin from the
user directory. It is information, not authority: SoftTrack's roles stay team
admin, member and guest plus the site admin, and nothing is allowed or
approved because of who manages whom.
"""

from typing import Optional

from sqlmodel import Session

from lib_softtrack.tables import User
from lib_utils.errors import ErrorCode, api_error

#: Far longer than any real reporting chain, and short enough that a chain
#: which somehow already loops cannot hang the request walking it.
_MAX_CHAIN = 1000


def assert_can_report_to(session: Session, person: User, manager: User) -> None:
    """Refuse a manager that would make a loop, with a sentence saying why.

    Walks upward from the new manager. Reaching `person` means the manager
    already reports to them, directly or through others, and the link would
    close the loop. Chains are short and the write is rare, so walking one per
    assignment is cheaper than keeping any structure up to date. Being your
    own manager is the one-step case of the same rule.
    """
    if manager.id == person.id:
        raise api_error(
            status_code=400,
            code=ErrorCode.manager_is_self,
            detail=f"{person.full_name} can’t be their own manager",
        )
    current = manager
    seen: set[int] = set()
    while current.manager_id is not None and len(seen) < _MAX_CHAIN:
        if current.manager_id == person.id:
            how = "reports to" if current.id == manager.id else "reports up to"
            raise api_error(
                status_code=400,
                code=ErrorCode.manager_cycle,
                detail=f"{person.full_name} can’t report to {manager.full_name}: "
                f"{manager.full_name} already {how} {person.full_name}",
            )
        if current.id in seen:
            break
        seen.add(current.id)
        current = session.get(User, current.manager_id)


def set_manager(session: Session, person: User, manager_id: Optional[int]) -> None:
    """Point `person` at a new manager, or at none."""
    if manager_id is None:
        person.manager_id = None
        return
    # Saving somebody's other details sends their manager back unchanged, and
    # that has to keep working after the manager is deactivated.
    if manager_id == person.manager_id:
        return

    manager = session.get(User, manager_id)
    if manager is None:
        raise api_error(
            status_code=400, code=ErrorCode.user_not_found, detail="No such person"
        )
    if manager.id != person.id and not manager.is_active:
        raise api_error(
            status_code=400,
            code=ErrorCode.manager_deactivated,
            detail=f"{manager.full_name}’s account is deactivated, so nobody new "
            "can report to them",
        )
    assert_can_report_to(session, person, manager)
    person.manager_id = manager.id
