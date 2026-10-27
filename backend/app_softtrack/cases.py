from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app_softtrack.guards import team_writer
from lib_identity.identity import get_current_insider
from lib_softtrack import cases as cases_service
from lib_softtrack.models.cases import (
    TestCaseCover,
    TestCaseCreate,
    TestCaseHit,
    TestCaseImport,
    TestCaseRead,
    TestCaseUpdate,
    TestCaseVersionRead,
    TestFolderCreate,
    TestFolderRead,
    TestFolderUpdate,
    TicketTestCases,
)
from lib_softtrack.tables import TestCaseState, User
from lib_utils.errors import ErrorCode, api_error
from web import get_session

#: Every route here is for somebody inside the organisation (#317): an
#: account from outside sees its epics' tickets and not how the team tests.
router = APIRouter(tags=["test cases"])

#: As the Jira import's: refused before reading.
MAX_UPLOAD_BYTES = 5 * 1024 * 1024


@router.get("/teams/{team_id}/test-folders", response_model=list[TestFolderRead])
def list_folders(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """A team's folders of test cases (#274), by name, with how many cases
    that are not retired each holds."""
    return cases_service.list_folders(session, current_user, team_id)


@router.post(
    "/teams/{team_id}/test-folders",
    response_model=TestFolderRead,
    dependencies=[team_writer],
)
def create_folder(
    team_id: int,
    payload: TestFolderCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    return cases_service.create_folder(session, current_user, team_id, payload)


@router.patch(
    "/test-folders/{folder_id}",
    response_model=TestFolderRead,
    dependencies=[team_writer],
)
def rename_folder(
    folder_id: int,
    payload: TestFolderUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    return cases_service.rename_folder(session, current_user, folder_id, payload)


@router.delete("/test-folders/{folder_id}", status_code=204, dependencies=[team_writer])
def delete_folder(
    folder_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """Delete a folder. Its cases are kept, in no folder."""
    cases_service.delete_folder(session, current_user, folder_id)


@router.get("/teams/{team_id}/test-cases", response_model=list[TestCaseRead])
def list_cases(
    team_id: int,
    folder_id: Optional[int] = Query(
        None, description="Only the cases in this folder."
    ),
    no_folder: bool = Query(False, description="Only the cases in no folder."),
    label_id: Optional[int] = Query(None, description="Only cases with this label."),
    state: Optional[TestCaseState] = Query(
        None, description="Only cases in this state."
    ),
    q: Optional[str] = Query(
        None, description="Words in the key, title, preconditions or steps."
    ),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """A team's test cases, by number: at most 500 of them."""
    return cases_service.list_cases(
        session,
        current_user,
        team_id,
        folder_id=folder_id,
        no_folder=no_folder,
        label_id=label_id,
        state=state,
        q=q,
    )


@router.post(
    "/teams/{team_id}/test-cases",
    response_model=TestCaseRead,
    dependencies=[team_writer],
)
def create_case(
    team_id: int,
    payload: TestCaseCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    return cases_service.create_case(session, current_user, team_id, payload)


@router.get("/teams/{team_id}/test-cases/export")
def export_cases(
    team_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """Every test case on the team, as CSV: the shape an import reads back."""
    chunks = cases_service.export_cases(session, current_user, team_id)
    return StreamingResponse(
        chunks,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=test-cases.csv"},
    )


@router.post(
    "/teams/{team_id}/test-cases/import",
    response_model=TestCaseImport,
    dependencies=[team_writer],
)
async def import_cases(
    team_id: int,
    file: UploadFile = File(..., description="A CSV in the export's shape."),
    dry_run: bool = Form(
        True, description="Report what would happen without writing anything."
    ),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """Make test cases of a CSV, a case a row. A dry run by default."""
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise api_error(
            status_code=413,
            code=ErrorCode.file_too_large,
            detail=f"That file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.",
        )
    if not raw:
        raise api_error(
            status_code=422, code=ErrorCode.file_empty, detail="That file is empty."
        )
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    return cases_service.import_cases(
        session, current_user, team_id, text, dry_run=dry_run
    )


@router.get("/test-cases/search", response_model=list[TestCaseHit])
def search_cases(
    q: str = Query(..., min_length=1, description="The words to look for."),
    team_id: Optional[int] = Query(None, description="Only this team's cases."),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """Test cases on the caller's teams that the words find (#274)."""
    return cases_service.search_cases(session, current_user, q, team_id)


@router.get("/test-cases/{case_id}", response_model=TestCaseRead)
def get_case(
    case_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    return cases_service.get_case(session, current_user, case_id)


@router.patch(
    "/test-cases/{case_id}", response_model=TestCaseRead, dependencies=[team_writer]
)
def update_case(
    case_id: int,
    payload: TestCaseUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """Change a case. A change to its title, preconditions or steps is a new
    version, kept with who made it."""
    return cases_service.update_case(session, current_user, case_id, payload)


@router.delete("/test-cases/{case_id}", status_code=204, dependencies=[team_writer])
def delete_case(
    case_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    cases_service.delete_case(session, current_user, case_id)


@router.get("/test-cases/{case_id}/versions", response_model=list[TestCaseVersionRead])
def list_versions(
    case_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """Every version of a case's text, newest first."""
    return cases_service.list_versions(session, current_user, case_id)


@router.post(
    "/test-cases/{case_id}/tickets",
    response_model=TestCaseRead,
    dependencies=[team_writer],
)
def cover(
    case_id: int,
    payload: TestCaseCover,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """Say the case covers a ticket on its team: a story, usually."""
    return cases_service.cover(session, current_user, case_id, payload.ticket_id)


@router.delete(
    "/test-cases/{case_id}/tickets/{ticket_id}",
    status_code=204,
    dependencies=[team_writer],
)
def uncover(
    case_id: int,
    ticket_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    cases_service.uncover(session, current_user, case_id, ticket_id)


@router.get("/tickets/{ticket_id}/test-cases", response_model=TicketTestCases)
def ticket_cases(
    ticket_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_insider),
):
    """The cases that cover a ticket, and whether its team keeps any."""
    return cases_service.ticket_cases(session, current_user, ticket_id)
