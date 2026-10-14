from typing import Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_insider
from lib_softtrack import attachments as attachments_service
from lib_softtrack import runs as runs_service
from lib_softtrack.models.runs import (
    CaseRun,
    TestResultFileRead,
    TestRunCaseRead,
    TestRunCaseUpdate,
    TestRunCreate,
    TestRunDetail,
    TestRunRead,
    TestRunUpdate,
)
from lib_softtrack.models.tickets import TicketCreate, TicketRead
from lib_softtrack.storage import ObjectNotFound, Storage, copy_stream, get_storage
from lib_softtrack.tables import User
from lib_utils.errors import ErrorCode, api_error
from web import get_session, settings

#: As for test cases (#274): for somebody inside the organisation only.
router = APIRouter(tags=["test runs"])


@router.get("/teams/{team_id}/test-runs", response_model=list[TestRunRead])
def list_runs(
    team_id: int,
    release_id: Optional[int] = Query(None, description="Only runs for this release."),
    sprint_id: Optional[int] = Query(None, description="Only runs for this sprint."),
    project_id: Optional[int] = Query(None, description="Only runs for this epic."),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """A team's test runs (#275), newest first, each with its tally."""
    return runs_service.list_runs(
        session,
        current_user,
        team_id,
        release_id=release_id,
        sprint_id=sprint_id,
        project_id=project_id,
    )


@router.post(
    "/teams/{team_id}/test-runs",
    response_model=TestRunDetail,
    dependencies=[team_writer],
)
def create_run(
    team_id: int,
    payload: TestRunCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """A run of a folder's cases, a label's, those picked, or all three."""
    return runs_service.create_run(session, current_user, team_id, payload)


@router.get("/test-runs/{run_id}", response_model=TestRunDetail)
def get_run(
    run_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    return runs_service.get_run(session, current_user, run_id)


@router.patch(
    "/test-runs/{run_id}", response_model=TestRunDetail, dependencies=[team_writer]
)
def update_run(
    run_id: int,
    payload: TestRunUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    return runs_service.update_run(session, current_user, run_id, payload)


@router.post(
    "/test-runs/{run_id}/close",
    response_model=TestRunDetail,
    dependencies=[team_writer],
)
def close_run(
    run_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """Close the run: its results are fixed. Testing again is a new run."""
    return runs_service.close_run(session, current_user, run_id)


@router.delete("/test-runs/{run_id}", status_code=204, dependencies=[team_writer])
def delete_run(
    run_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    current_user: User = Depends(get_current_insider),
):
    """Delete an open run made by mistake. A closed one is history."""
    runs_service.delete_run(session, storage, current_user, run_id)


@router.patch(
    "/test-run-cases/{run_case_id}",
    response_model=TestRunCaseRead,
    dependencies=[team_writer],
)
def update_run_case(
    run_case_id: int,
    payload: TestRunCaseUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """A case's result in a run -- passed, failed, blocked or skipped, with a
    note and the step that failed -- or who is to run it."""
    return runs_service.update_run_case(session, current_user, run_case_id, payload)


@router.post(
    "/test-run-cases/{run_case_id}/bug",
    response_model=TicketRead,
    dependencies=[team_writer],
)
def raise_bug(
    run_case_id: int,
    payload: TicketCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """Raise a bug from a failure: the ticket, linked to the stories the case
    covers, and the result linked to it."""
    return runs_service.raise_bug(session, current_user, run_case_id, payload)


@router.post(
    "/test-run-cases/{run_case_id}/files",
    response_model=TestResultFileRead,
    dependencies=[team_writer],
)
async def add_file(
    run_case_id: int,
    file: UploadFile = File(..., description="The file, with the result."),
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    current_user: User = Depends(get_current_insider),
):
    """A file with a result: the screenshot of what happened."""
    limit = settings.attachment_max_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise api_error(
            status_code=413,
            code=ErrorCode.file_too_large,
            detail=f"That file is larger than {limit // (1024 * 1024)}MB.",
        )
    return runs_service.add_file(
        session, storage, current_user, run_case_id, file, data
    )


@router.get("/test-result-files/{result_file_id}/content")
def download_file(
    result_file_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    current_user: User = Depends(get_current_insider),
):
    """The bytes, served as a ticket's attachments are."""
    file = runs_service.file_for_read(session, current_user, result_file_id)
    try:
        body = storage.open(file.storage_key)
    except ObjectNotFound:
        raise api_error(
            status_code=410,
            code=ErrorCode.attachment_gone,
            detail="That file is no longer stored.",
        )
    return StreamingResponse(
        copy_stream(body),
        media_type=attachments_service.served_type(file),
        headers={
            "Content-Disposition": attachments_service.content_disposition_for(
                file.filename, file.content_type
            ),
            "Content-Length": str(file.size_bytes),
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


@router.delete(
    "/test-result-files/{result_file_id}",
    status_code=204,
    dependencies=[team_writer],
)
def delete_file(
    result_file_id: int,
    session: Session = Depends(get_session),
    storage: Storage = Depends(get_storage),
    current_user: User = Depends(get_current_insider),
):
    runs_service.delete_file(session, storage, current_user, result_file_id)


@router.get("/test-cases/{case_id}/runs", response_model=list[CaseRun])
def case_runs(
    case_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """Every run a case has been in, newest first, with the version each ran."""
    return runs_service.case_runs(session, current_user, case_id)
