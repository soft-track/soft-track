from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlmodel import Session

from lib_identity.identity import get_current_user
from lib_softtrack import importer
from lib_softtrack.models.imports import ImportReport
from lib_softtrack.tables import User
from web import get_session

router = APIRouter(tags=["import"])

#: Refused before reading, so a large upload cannot exhaust memory. A Jira
#: export of 20,000 issues is comfortably under this.
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


@router.post("/teams/{team_id}/import/jira", response_model=ImportReport)
async def import_jira(
    team_id: int,
    file: UploadFile = File(..., description="A Jira CSV or JSON export."),
    dry_run: bool = Form(
        True, description="Report what would happen without writing anything."
    ),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Import a Jira export into this team.

    Defaults to a dry run. The dry run takes exactly the same path as the real
    one and rolls back at the end, so the report you approve is the report you
    then get -- rather than a preview built by separate code that can drift
    from what the import actually does.
    """
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"That file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.",
        )
    if not raw:
        raise HTTPException(status_code=422, detail="That file is empty.")

    try:
        # Jira exports from the Cloud UI are frequently UTF-8 with a BOM, and
        # utf-8-sig strips it; a stray BOM otherwise corrupts the first header
        # and every lookup against it fails.
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = raw.decode("latin-1")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=422,
                detail="Could not read that file as text. Export it as UTF-8.",
            )

    return importer.import_export(
        session,
        current_user,
        team_id,
        filename=file.filename or "",
        content=text,
        dry_run=dry_run,
    )
