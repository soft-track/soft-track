"""Test runs (#275): a pass through a team's test cases, with results and
the bugs they raised.

Test cases (#274) say how to test. A run says that it was done: by whom,
against what, and what happened. Three decisions shape it.

**A run is what was run.** Its cases are chosen when it is made -- a
folder's, a label's, or picked by hand -- and copied in, each at the version
of its text it was run at. Moving a case to another folder afterwards, or
rewriting it, does not change what a run says was tested.

**A closed run is history.** Closing it fixes its results; testing again is a
new run. Nothing here reopens one.

**There is no gate.** A run informs the decision to release; it never
refuses one. Releasing (#272) does not ask a run anything.
"""

from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from fastapi import UploadFile
from sqlalchemy import case as sql_case
from sqlalchemy import delete, func
from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack import attachments as attachments_service
from lib_softtrack.bug_details import environment_for
from lib_softtrack.cases import get_case_or_404, identifier as case_identifier
from lib_softtrack.models.cases import TestStep
from lib_softtrack.models.runs import (
    BugRef,
    CaseRun,
    TestResultFileRead,
    TestRunCaseRead,
    TestRunCaseUpdate,
    TestRunCreate,
    TestRunDetail,
    TestRunProgress,
    TestRunRead,
    TestRunUpdate,
)
from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.models.tickets import TicketCreate, TicketRead
from lib_softtrack.storage import Storage
from lib_softtrack.tables import (
    Label,
    Project,
    Release,
    Sprint,
    Team,
    TestCase,
    TestCaseLabel,
    TestCaseState,
    TestCaseTicket,
    TestCaseVersion,
    TestFolder,
    TestResult,
    TestResultFile,
    TestRun,
    TestRunCase,
    TestRunState,
    Ticket,
    TicketEvent,
    TicketEventField,
    TicketLink,
    TicketLinkType,
    TicketType,
    User,
    WorkflowStatus,
)
from lib_softtrack.teams import (
    get_team_or_404,
    require_assignable,
    require_team_member,
)
from lib_utils.errors import ErrorCode, api_error


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --- lookups ---------------------------------------------------------------


def get_run_or_404(session: Session, run_id: int) -> TestRun:
    run = session.get(TestRun, run_id)
    if run is None:
        raise api_error(
            status_code=404, code=ErrorCode.test_run_not_found, detail="Run not found"
        )
    return run


def get_run_case_or_404(session: Session, run_case_id: int) -> TestRunCase:
    row = session.get(TestRunCase, run_case_id)
    if row is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.test_run_case_not_found,
            detail="That case is not in a run",
        )
    return row


def get_file_or_404(session: Session, file_id: int) -> TestResultFile:
    row = session.get(TestResultFile, file_id)
    if row is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.test_result_file_not_found,
            detail="File not found",
        )
    return row


def _require_open(run: TestRun) -> None:
    if run.state is TestRunState.closed:
        raise api_error(
            status_code=409,
            code=ErrorCode.test_run_closed,
            detail=f"{run.name} is closed, so its results are fixed. Testing "
            "again is a new run.",
        )


def _on_team(session: Session, table, row_id: Optional[int], team_id: int, noun: str):
    if row_id is None:
        return None
    row = session.get(table, row_id)
    if row is None or row.team_id != team_id:
        raise api_error(
            status_code=400,
            code=ErrorCode.not_on_this_team,
            detail=f"No such {noun} on this team",
        )
    return row


def _check(session: Session, team: Team, data: dict) -> dict:
    """What a run names, on its team; the environment in the team's spelling."""
    _on_team(session, Release, data.get("release_id"), team.id, "release")
    _on_team(session, Sprint, data.get("sprint_id"), team.id, "sprint")
    _on_team(session, Project, data.get("project_id"), team.id, "epic")
    if data.get("owner_id") is not None:
        require_assignable(team.id, data["owner_id"], session)
    if data.get("environment"):
        data["environment"] = environment_for(team, data["environment"])
    elif "environment" in data:
        data["environment"] = None
    return data


# --- reading ---------------------------------------------------------------


def progress(session: Session, run_ids: list[int]) -> dict[int, TestRunProgress]:
    """Each run's tally in one query."""
    counted = {
        run_id: TestRunProgress(
            total=0, passed=0, failed=0, blocked=0, skipped=0, not_run=0, bugs=0
        )
        for run_id in run_ids
    }
    if not run_ids:
        return counted

    def count(result: TestResult):
        return func.coalesce(
            func.sum(sql_case((TestRunCase.result == result, 1), else_=0)), 0
        )

    for row in session.exec(
        select(
            TestRunCase.run_id,
            func.count(),
            count(TestResult.passed),
            count(TestResult.failed),
            count(TestResult.blocked),
            count(TestResult.skipped),
            func.coalesce(
                func.sum(sql_case((TestRunCase.result.is_(None), 1), else_=0)), 0
            ),
            func.count(TestRunCase.bug_id),
        )
        .where(TestRunCase.run_id.in_(run_ids))
        .group_by(TestRunCase.run_id)
    ).all():
        run_id, total, passed, failed, blocked, skipped, not_run, bugs = row
        counted[run_id] = TestRunProgress(
            total=int(total),
            passed=int(passed),
            failed=int(failed),
            blocked=int(blocked),
            skipped=int(skipped),
            not_run=int(not_run),
            bugs=int(bugs),
        )
    return counted


def _users(session: Session, ids: set) -> dict[int, UserPublic]:
    ids = {user_id for user_id in ids if user_id}
    if not ids:
        return {}
    return {
        user.id: UserPublic.model_validate(user)
        for user in session.exec(select(User).where(User.id.in_(ids))).all()
    }


def _run_reads(session: Session, runs: list[TestRun]) -> list[TestRunRead]:
    tallies = progress(session, [run.id for run in runs])
    owners = _users(session, {run.owner_id for run in runs})
    return [
        TestRunRead(
            id=run.id,
            team_id=run.team_id,
            name=run.name,
            release_id=run.release_id,
            sprint_id=run.sprint_id,
            project_id=run.project_id,
            environment=run.environment,
            owner=owners.get(run.owner_id),
            state=run.state,
            progress=tallies[run.id],
            created_at=run.created_at,
            closed_at=run.closed_at,
        )
        for run in runs
    ]


def _case_reads(session: Session, rows: list[TestRunCase]) -> list[TestRunCaseRead]:
    """Run cases with the text of the version run, who did what, the bug and
    the files: a query each, whatever the number of cases."""
    if not rows:
        return []
    cases = {
        case.id: case
        for case in session.exec(
            select(TestCase).where(TestCase.id.in_({row.case_id for row in rows}))
        ).all()
    }
    versions = {
        (version.case_id, version.version): version
        for version in session.exec(
            select(TestCaseVersion).where(TestCaseVersion.case_id.in_(set(cases)))
        ).all()
    }
    covers: dict[int, list[str]] = defaultdict(list)
    for case_id, team_key, number in session.exec(
        select(TestCaseTicket.case_id, Team.key, Ticket.number)
        .join(Ticket, Ticket.id == TestCaseTicket.ticket_id)
        .join(Team, Team.id == Ticket.team_id)
        .where(TestCaseTicket.case_id.in_(set(cases)))
        .order_by(Ticket.number)
    ).all():
        covers[case_id].append(f"{team_key}-{number}")
    bugs = {
        ticket.id: BugRef(
            id=ticket.id,
            identifier=f"{team.key}-{ticket.number}",
            title=ticket.title,
            status=StatusRead.model_validate(status),
        )
        for ticket, team, status in session.exec(
            select(Ticket, Team, WorkflowStatus)
            .join(Team, Team.id == Ticket.team_id)
            .join(WorkflowStatus, WorkflowStatus.id == Ticket.status_id)
            .where(Ticket.id.in_({row.bug_id for row in rows if row.bug_id}))
        ).all()
    }
    files: dict[int, list[TestResultFileRead]] = defaultdict(list)
    for file in session.exec(
        select(TestResultFile)
        .where(TestResultFile.run_case_id.in_([row.id for row in rows]))
        .order_by(TestResultFile.id)
    ).all():
        files[file.run_case_id].append(
            TestResultFileRead(
                id=file.id,
                filename=file.filename,
                content_type=file.content_type,
                size_bytes=file.size_bytes,
                created_at=file.created_at,
            )
        )
    people = _users(
        session, {row.assignee_id for row in rows} | {row.ran_by_id for row in rows}
    )

    reads = []
    for row in rows:
        case = cases[row.case_id]
        text = versions.get((row.case_id, row.version))
        reads.append(
            TestRunCaseRead(
                id=row.id,
                run_id=row.run_id,
                case_id=row.case_id,
                identifier=case_identifier(case),
                version=row.version,
                title=text.title if text else case.title,
                steps=[
                    TestStep(**step)
                    for step in ((text.steps if text else case.steps) or [])
                ],
                covers=covers.get(row.case_id, []),
                assignee=people.get(row.assignee_id),
                result=row.result,
                note=row.note,
                failed_step=row.failed_step,
                ran_by=people.get(row.ran_by_id),
                ran_at=row.ran_at,
                bug=bugs.get(row.bug_id),
                files=files.get(row.id, []),
            )
        )
    return reads


def _rows(session: Session, run_id: int) -> list[TestRunCase]:
    return list(
        session.exec(
            select(TestRunCase)
            .join(TestCase, TestCase.id == TestRunCase.case_id)
            .where(TestRunCase.run_id == run_id)
            .order_by(TestCase.number)
        ).all()
    )


def _detail(session: Session, run: TestRun) -> TestRunDetail:
    return TestRunDetail(
        run=_run_reads(session, [run])[0],
        cases=_case_reads(session, _rows(session, run.id)),
    )


def list_runs(
    session: Session,
    current_user: User,
    team_id: int,
    release_id: Optional[int] = None,
    sprint_id: Optional[int] = None,
    project_id: Optional[int] = None,
) -> list[TestRunRead]:
    """A team's runs, newest first -- or those for one release, sprint or epic."""
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    clauses = [TestRun.team_id == team_id]
    for column, value in (
        (TestRun.release_id, release_id),
        (TestRun.sprint_id, sprint_id),
        (TestRun.project_id, project_id),
    ):
        if value is not None:
            clauses.append(column == value)
    runs = session.exec(
        select(TestRun)
        .where(*clauses)
        .order_by(TestRun.created_at.desc(), TestRun.id.desc())
    ).all()
    return _run_reads(session, list(runs))


def get_run(session: Session, current_user: User, run_id: int) -> TestRunDetail:
    run = get_run_or_404(session, run_id)
    require_team_member(run.team_id, current_user, session)
    return _detail(session, run)


# --- making and changing a run ---------------------------------------------


def _chosen(session: Session, team_id: int, payload: TestRunCreate) -> list[TestCase]:
    """The cases a new run takes: a folder's, a label's and those picked,
    together, by number -- and none that is retired."""
    _on_team(session, TestFolder, payload.folder_id, team_id, "folder")
    _on_team(session, Label, payload.label_id, team_id, "label")
    for case_id in payload.case_ids:
        _on_team(session, TestCase, case_id, team_id, "test case")

    chosen: set[int] = set(payload.case_ids)
    if payload.folder_id is not None:
        chosen |= set(
            session.exec(
                select(TestCase.id).where(TestCase.folder_id == payload.folder_id)
            ).all()
        )
    if payload.label_id is not None:
        chosen |= set(
            session.exec(
                select(TestCaseLabel.case_id).where(
                    TestCaseLabel.label_id == payload.label_id
                )
            ).all()
        )
    if not chosen:
        return []
    return list(
        session.exec(
            select(TestCase)
            .where(
                TestCase.id.in_(chosen),
                TestCase.team_id == team_id,
                TestCase.state != TestCaseState.retired,
            )
            .order_by(TestCase.number)
        ).all()
    )


def create_run(
    session: Session, current_user: User, team_id: int, payload: TestRunCreate
) -> TestRunDetail:
    team = get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    data = _check(session, team, payload.model_dump())
    cases = _chosen(session, team_id, payload)
    if not cases:
        raise api_error(
            status_code=422,
            code=ErrorCode.test_run_empty,
            detail="A run needs a case to run: choose a folder, a label or some "
            "cases that are not retired.",
        )
    run = TestRun(
        team_id=team_id,
        name=payload.name,
        release_id=payload.release_id,
        sprint_id=payload.sprint_id,
        project_id=payload.project_id,
        environment=data.get("environment"),
        owner_id=payload.owner_id,
        created_by_id=current_user.id,
    )
    session.add(run)
    session.flush()
    for case in cases:
        session.add(TestRunCase(run_id=run.id, case_id=case.id, version=case.version))
    session.commit()
    session.refresh(run)
    return _detail(session, run)


def update_run(
    session: Session, current_user: User, run_id: int, payload: TestRunUpdate
) -> TestRunDetail:
    run = get_run_or_404(session, run_id)
    require_team_member(run.team_id, current_user, session)
    _require_open(run)
    data = _check(
        session, session.get(Team, run.team_id), payload.model_dump(exclude_unset=True)
    )
    if data.get("name") is not None:
        run.name = data["name"]
    for field in ("release_id", "sprint_id", "project_id", "environment", "owner_id"):
        if field in data:
            setattr(run, field, data[field])
    session.add(run)
    session.commit()
    session.refresh(run)
    return _detail(session, run)


def close_run(session: Session, current_user: User, run_id: int) -> TestRunDetail:
    """Close a run: its results are fixed from now on."""
    run = get_run_or_404(session, run_id)
    require_team_member(run.team_id, current_user, session)
    if run.state is TestRunState.open:
        run.state = TestRunState.closed
        run.closed_at = _now()
        run.closed_by_id = current_user.id
        session.add(run)
        session.commit()
        session.refresh(run)
    return _detail(session, run)


def delete_run(
    session: Session, storage: Storage, current_user: User, run_id: int
) -> None:
    """Delete an open run made by mistake. A closed one is history."""
    run = get_run_or_404(session, run_id)
    require_team_member(run.team_id, current_user, session)
    _require_open(run)
    rows = [row.id for row in _rows(session, run.id)]
    keys = (
        list(
            session.exec(
                select(TestResultFile.storage_key).where(
                    TestResultFile.run_case_id.in_(rows)
                )
            ).all()
        )
        if rows
        else []
    )
    if rows:
        session.exec(delete(TestResultFile).where(TestResultFile.run_case_id.in_(rows)))
    session.exec(delete(TestRunCase).where(TestRunCase.run_id == run.id))
    session.flush()
    session.delete(run)
    session.commit()
    attachments_service.purge(storage, keys)


# --- results ---------------------------------------------------------------


def _record_on_bug(
    session: Session,
    row: TestRunCase,
    run: TestRun,
    value: str,
    actor: Optional[User],
) -> None:
    """A line in the history of the bug a result raised (#275), written as it
    was: `failed|TC-05|1.4.0 regression`."""
    if row.bug_id is None:
        return
    bug = session.get(Ticket, row.bug_id)
    if bug is None:
        return
    case = session.get(TestCase, row.case_id)
    session.add(
        TicketEvent(
            ticket_id=bug.id,
            team_id=bug.team_id,
            field=TicketEventField.test_result,
            new_value=f"{value}|{case_identifier(case)}|{run.name}",
            actor_id=actor.id if actor else None,
        )
    )


def update_run_case(
    session: Session, current_user: User, run_case_id: int, payload: TestRunCaseUpdate
) -> TestRunCaseRead:
    """Give a case in a run its result, or somebody to run it."""
    row = get_run_case_or_404(session, run_case_id)
    run = session.get(TestRun, row.run_id)
    require_team_member(run.team_id, current_user, session)
    _require_open(run)
    data = payload.model_dump(exclude_unset=True)

    if "assignee_id" in data:
        if data["assignee_id"] is not None:
            require_assignable(run.team_id, data["assignee_id"], session)
        row.assignee_id = data["assignee_id"]
    if "note" in data:
        row.note = (data["note"] or "").strip() or None

    if "result" in data and data["result"] != row.result:
        row.result = data["result"]
        if row.result is None:
            row.ran_by_id = None
            row.ran_at = None
        else:
            # The version run is the one the case is at now.
            row.version = get_case_or_404(session, row.case_id).version
            row.ran_by_id = current_user.id
            row.ran_at = _now()
        _record_on_bug(
            session,
            row,
            run,
            row.result.value if row.result else "not_run",
            current_user,
        )
    if "failed_step" in data:
        row.failed_step = data["failed_step"]
    if row.result is not TestResult.failed:
        # A step only fails in a failure.
        row.failed_step = None

    session.add(row)
    session.commit()
    session.refresh(row)
    return _case_reads(session, [row])[0]


def raise_bug(
    session: Session, current_user: User, run_case_id: int, payload: TicketCreate
) -> TicketRead:
    """A bug from a failure (#275): the ticket as the person filled it in --
    the form arrives filled from the case -- linked to the stories the case
    covers, and the result linked to it. Its history begins with the result
    that raised it."""
    # Imported here: tickets read releases and cases, which read this.
    from lib_softtrack import tickets as tickets_service

    row = get_run_case_or_404(session, run_case_id)
    run = session.get(TestRun, row.run_id)
    require_team_member(run.team_id, current_user, session)
    _require_open(run)
    if row.result is not TestResult.failed or row.bug_id is not None:
        raise api_error(
            status_code=409,
            code=ErrorCode.test_result_not_failed,
            detail=(
                "That result has its bug already."
                if row.bug_id is not None
                else "A bug is raised from a failure."
            ),
        )

    payload = payload.model_copy(update={"type": TicketType.bug})
    created = tickets_service.create_ticket(session, current_user, run.team_id, payload)

    row.bug_id = created.id
    session.add(row)
    for ticket_id in session.exec(
        select(TestCaseTicket.ticket_id)
        .join(Ticket, Ticket.id == TestCaseTicket.ticket_id)
        .where(TestCaseTicket.case_id == row.case_id, Ticket.team_id == run.team_id)
    ).all():
        session.add(
            TicketLink(
                source_id=created.id,
                target_id=ticket_id,
                type=TicketLinkType.relates_to,
                created_by_id=current_user.id,
            )
        )
    _record_on_bug(session, row, run, "raised", current_user)
    session.commit()
    return tickets_service.get_ticket(session, current_user, created.id)


# --- files with a result ---------------------------------------------------


def _file_read(file: TestResultFile) -> TestResultFileRead:
    return TestResultFileRead(
        id=file.id,
        filename=file.filename,
        content_type=file.content_type,
        size_bytes=file.size_bytes,
        created_at=file.created_at,
    )


def add_file(
    session: Session,
    storage: Storage,
    current_user: User,
    run_case_id: int,
    upload: UploadFile,
    data: bytes,
) -> TestResultFileRead:
    row = get_run_case_or_404(session, run_case_id)
    run = session.get(TestRun, row.run_id)
    require_team_member(run.team_id, current_user, session)
    _require_open(run)
    filename, content_type = attachments_service.check_upload(
        upload.filename or "", data
    )
    key = attachments_service.new_storage_key(filename)
    storage.write(key, data)
    file = TestResultFile(
        run_case_id=row.id,
        filename=filename,
        content_type=content_type,
        size_bytes=len(data),
        storage_key=key,
        uploaded_by_id=current_user.id,
    )
    session.add(file)
    try:
        session.commit()
    except Exception:
        session.rollback()
        storage.delete(key)
        raise
    session.refresh(file)
    return _file_read(file)


def file_for_read(session: Session, current_user: User, file_id: int) -> TestResultFile:
    file = get_file_or_404(session, file_id)
    row = session.get(TestRunCase, file.run_case_id)
    run = session.get(TestRun, row.run_id)
    require_team_member(run.team_id, current_user, session)
    return file


def delete_file(
    session: Session, storage: Storage, current_user: User, file_id: int
) -> None:
    file = get_file_or_404(session, file_id)
    row = session.get(TestRunCase, file.run_case_id)
    run = session.get(TestRun, row.run_id)
    require_team_member(run.team_id, current_user, session)
    _require_open(run)
    key = file.storage_key
    session.delete(file)
    session.commit()
    attachments_service.purge(storage, [key])


# --- a case's runs, and what goes when something else does ----------------


def case_runs(session: Session, current_user: User, case_id: int) -> list[CaseRun]:
    """Every run a case has been in, newest first, with the version each
    executed (#275)."""
    case = get_case_or_404(session, case_id)
    require_team_member(case.team_id, current_user, session)
    rows = session.exec(
        select(TestRunCase, TestRun)
        .join(TestRun, TestRun.id == TestRunCase.run_id)
        .where(TestRunCase.case_id == case.id)
        .order_by(TestRun.created_at.desc(), TestRun.id.desc())
    ).all()
    people = _users(session, {row.ran_by_id for row, _ in rows})
    return [
        CaseRun(
            run_id=run.id,
            run_name=run.name,
            state=run.state,
            version=row.version,
            result=row.result,
            ran_by=people.get(row.ran_by_id),
            ran_at=row.ran_at,
            created_at=run.created_at,
        )
        for row, run in rows
    ]


def last_results(session: Session, case_ids: list[int]) -> dict[int, TestResult]:
    """Each case's latest result in any run (#275): what its row says."""
    if not case_ids:
        return {}
    found: dict[int, TestResult] = {}
    for case_id, result in session.exec(
        select(TestRunCase.case_id, TestRunCase.result)
        .where(TestRunCase.case_id.in_(case_ids), TestRunCase.result.is_not(None))
        .order_by(TestRunCase.ran_at.desc(), TestRunCase.id.desc())
    ).all():
        found.setdefault(case_id, result)
    return found


def forget_ticket(session: Session, ticket_id: int) -> None:
    """A bug is purged: the result that raised it no longer links to it."""
    for row in session.exec(
        select(TestRunCase).where(TestRunCase.bug_id == ticket_id)
    ).all():
        row.bug_id = None
        session.add(row)


def forget(session: Session, column, row_id: int) -> None:
    """A release, sprint or epic is going: the runs that were for it stay,
    for nothing in particular."""
    for run in session.exec(select(TestRun).where(column == row_id)).all():
        setattr(run, column.key, None)
        session.add(run)
