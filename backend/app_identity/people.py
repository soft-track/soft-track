from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from lib_identity import people as people_service
from lib_identity.identity import get_current_user
from lib_identity.models.people import PeoplePage
from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT
from lib_softtrack.tables import User
from web import get_session

# `/users` rather than `/people`: the browser app's pages are `/people` and
# `/people/<username>`, and on a single-domain deployment the SPA's first path
# segments have to stay disjoint from the API's (see docs/deployment.md).
router = APIRouter(prefix="/users", tags=["people"])


@router.get("", response_model=PeoplePage)
def list_people(
    q: Optional[str] = Query(
        default=None, description="Search name, username or job title"
    ),
    department_id: Optional[int] = Query(default=None),
    manager: Optional[str] = Query(
        default=None, description="Only the people reporting to this username"
    ),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """Every active account, by name: the people directory.

    Open to anyone signed in, and not scoped to your teams -- a directory is
    instance-wide on purpose. The filters compose, and are applied by the
    database, which also pages.
    """
    return people_service.list_people(
        session,
        q=q,
        department_id=department_id,
        manager=manager,
        limit=limit,
        offset=offset,
    )
