from typing import Optional

from fastapi import APIRouter, Depends, Query, Response
from sqlmodel import Session

from lib_identity import admin as admin_service
from lib_identity.admin import require_site_admin
from lib_identity.models.admin import (
    AdminPasswordReset,
    AdminUserRead,
    AdminUserUpdate,
)
from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT, Page
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=Page[AdminUserRead])
def list_users(
    q: Optional[str] = Query(
        default=None, description="Search name, email or username"
    ),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
    _: User = Depends(require_site_admin),
):
    return admin_service.list_users(session, q=q, limit=limit, offset=offset)


@router.patch("/users/{user_id}", response_model=AdminUserRead)
def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    session: Session = Depends(get_session),
    actor: User = Depends(require_site_admin),
):
    return admin_service.update_user(session, actor, user_id, payload)


@router.post("/users/{user_id}/reset-password", status_code=204)
def reset_password(
    user_id: int,
    payload: AdminPasswordReset,
    session: Session = Depends(get_session),
    actor: User = Depends(require_site_admin),
):
    admin_service.reset_password(session, actor, user_id, payload.new_password)
    return Response(status_code=204)
