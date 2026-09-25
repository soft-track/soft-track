"""Route-level permission guards.

`team_writer` is how a guest (#104) is kept read-only: every route that changes
something inside a team lists it in its `dependencies`, and it refuses guests
before the handler -- or even the request body -- is looked at. One place
rather than a check in each service, so a new route cannot forget half of it:
tests/test_guest_role.py sweeps the OpenAPI schema and fails on any mutating
team route a guest can reach.
"""

from fastapi import Depends, Request
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack.tables import User
from lib_softtrack.teams import require_team_writer, team_id_for_path
from web import get_session


def _require_team_writer(
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> None:
    team_id = team_id_for_path(session, request.path_params)
    require_team_writer(team_id, current_user, session)


#: `dependencies=[team_writer]` on a route: admins and members only.
team_writer = Depends(_require_team_writer)
