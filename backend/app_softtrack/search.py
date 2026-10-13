from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app_softtrack.filter_params import ticket_filters
from lib_identity.identity import get_current_user
from lib_softtrack import search as search_service
from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT, Page
from lib_softtrack.models.search import SearchHit
from lib_softtrack.models.views import ViewFilters
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["search"])


@router.get("/search", response_model=Page[SearchHit])
def search(
    q: str = Query(..., min_length=1, description="What to search for."),
    team_id: Optional[int] = Query(
        None, description="Restrict to one team. Defaults to every team you are in."
    ),
    filters: ViewFilters = Depends(ticket_filters),
    today: Optional[date] = Query(
        None,
        description="The caller's own date, which `due` and the updated and "
        "created windows are measured from.",
    ),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Search ticket titles, descriptions and comments.

    Always scoped to the teams the caller belongs to. Postgres uses full-text
    search with stemming and relevance ranking; SQLite falls back to a
    substring match. Takes the same filters as the ticket list (#261), so a
    search can be narrowed without leaving it.
    """
    return search_service.search_tickets(
        session,
        current_user,
        q,
        team_id=team_id,
        filters=filters,
        today=today,
        limit=limit,
        offset=offset,
    )
