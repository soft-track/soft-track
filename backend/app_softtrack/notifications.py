from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack import notifications as notifications_service
from lib_softtrack.models.notifications import (
    NotificationRead,
    NotificationSettings,
    NotificationSettingsUpdate,
    NotificationUpdate,
    UnreadCount,
    WatchState,
)
from lib_softtrack.models.page import DEFAULT_LIMIT, MAX_LIMIT, Page
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=Page[NotificationRead])
def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return notifications_service.list_notifications(
        session, current_user, unread_only=unread_only, limit=limit, offset=offset
    )


@router.get("/notifications/unread-count", response_model=UnreadCount)
def unread_count(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Just the badge. Separate from the list because it is polled and the
    list is not -- a poll that dragged fifty rows over the wire to render one
    number would be paid for on every open tab."""
    return notifications_service.unread_count(session, current_user)


@router.get("/notifications/settings", response_model=NotificationSettings)
def get_notification_settings(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return notifications_service.get_settings(session, current_user)


@router.patch("/notifications/settings", response_model=NotificationSettings)
def update_notification_settings(
    payload: NotificationSettingsUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return notifications_service.update_settings(
        session, current_user, payload.email_notifications
    )


@router.post("/notifications/read-all", response_model=UnreadCount)
def mark_all_read(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return notifications_service.mark_all_read(session, current_user)


# Registered after the static paths above so that "settings" and "read-all"
# are never read as a notification id.
@router.patch("/notifications/{notification_id}", response_model=NotificationRead)
def update_notification(
    notification_id: int,
    payload: NotificationUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return notifications_service.set_read(
        session, current_user, notification_id, payload.read
    )


@router.get("/issues/{issue_id}/watch", response_model=WatchState)
def get_watch_state(
    issue_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return notifications_service.get_watch_state(session, current_user, issue_id)


@router.put("/issues/{issue_id}/watch", response_model=WatchState)
def set_watch_state(
    issue_id: int,
    payload: WatchState,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    return notifications_service.set_watching(
        session, current_user, issue_id, payload.watching
    )
