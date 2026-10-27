"""Test cases a team keeps (#274), and the folders they are kept in.

How to test the invoice page was known to whoever tested it last. A test
case writes it down: a title, preconditions, and numbered steps, each with
what should happen. When that person is away, the release is tested the same
way.

Three decisions shape this module.

**Folders are one level deep.** Labels -- the team's own, the ones its
tickets carry -- cut across them. A tree of folders is where a test suite
goes to be lost.

**The text is versioned.** A change to the title, the preconditions or the
steps is a new version, kept with who made it and, if they said, what
changed. A run (#275) records the version it executed, so a result from
March still says what was tested in March. The folder, owner, state and
labels change no version: they change nothing about what is tested.

**A case covers tickets on its own team.** A story lists the cases that cover
it, and a case the stories it covers.
"""

import csv
import io
import re
from collections import defaultdict
from collections.abc import Iterator
from typing import Optional

from sqlalchemy import String, cast, delete, func, or_
from sqlmodel import Session, select

from lib_identity.models.identity import UserPublic
from lib_softtrack.models.cases import (
    CoveredTicket,
    TestCaseCreate,
    TestCaseHit,
    TestCaseImport,
    TestCaseRead,
    TestCaseUpdate,
    TestCaseVersionRead,
    TestFolderCreate,
    TestFolderRead,
    TestFolderUpdate,
    TestStep,
    TicketTestCase,
    TicketTestCases,
)
from lib_softtrack.models.labels import LabelRead
from lib_softtrack.models.statuses import StatusRead
from lib_softtrack.tables import (
    Label,
    Team,
    TeamMember,
    TestCase,
    TestCaseLabel,
    TestCaseState,
    TestCaseTicket,
    TestCaseVersion,
    TestFolder,
    TestRunCase,
    Ticket,
    User,
    WorkflowStatus,
    utcnow,
)
from lib_softtrack.teams import (
    get_team_or_404,
    require_assignable,
    require_team_member,
    require_team_writer,
)
from lib_utils.errors import ErrorCode, api_error
from lib_utils.spreadsheet import BOM, safe_text

#: The most cases one list returns. A team with more narrows by folder,
#: label or search -- a list of a thousand cases is read by nobody.
LIST_LIMIT = 500

#: The text fields whose change is a new version.
_VERSIONED = ("title", "preconditions", "steps")


def identifier(case: TestCase) -> str:
    """ "TC-21": per team, like a ticket's key, with no team in it -- a case
    is only ever read beside its team's tests."""
    return f"TC-{case.number}"


# --- lookups ---------------------------------------------------------------


def get_case_or_404(session: Session, case_id: int) -> TestCase:
    case = session.get(TestCase, case_id)
    if case is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.test_case_not_found,
            detail="Test case not found",
        )
    return case


def get_folder_or_404(session: Session, folder_id: int) -> TestFolder:
    folder = session.get(TestFolder, folder_id)
    if folder is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.test_folder_not_found,
            detail="Folder not found",
        )
    return folder


def _on_team(session: Session, table, row_id: Optional[int], team_id: int, noun: str):
    """A row from the request, checked against the team, as tickets do."""
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


def _labels_on_team(session: Session, team_id: int, label_ids: list[int]) -> list[int]:
    wanted = list(dict.fromkeys(label_ids))
    for label_id in wanted:
        _on_team(session, Label, label_id, team_id, "label")
    return wanted


def _clean_steps(steps: list[TestStep]) -> list[dict]:
    """The steps as stored: trimmed, and a step with nothing in it dropped."""
    cleaned = []
    for step in steps:
        action, expected = step.action.strip(), step.expected.strip()
        if action or expected:
            cleaned.append({"action": action, "expected": expected})
    return cleaned


def _text(value: Optional[str]) -> Optional[str]:
    return value.strip() or None if value is not None else None


# --- reading ---------------------------------------------------------------


def _reads(session: Session, cases: list[TestCase]) -> list[TestCaseRead]:
    """Cases with their labels, owners and covered tickets, a query each."""
    if not cases:
        return []
    ids = [case.id for case in cases]

    labels: dict[int, list[LabelRead]] = defaultdict(list)
    for case_id, label in session.exec(
        select(TestCaseLabel.case_id, Label)
        .join(Label, Label.id == TestCaseLabel.label_id)
        .where(TestCaseLabel.case_id.in_(ids))
        .order_by(Label.name)
    ).all():
        labels[case_id].append(LabelRead.model_validate(label, from_attributes=True))

    covers: dict[int, list[CoveredTicket]] = defaultdict(list)
    for case_id, ticket, team, status in session.exec(
        select(TestCaseTicket.case_id, Ticket, Team, WorkflowStatus)
        .join(Ticket, Ticket.id == TestCaseTicket.ticket_id)
        .join(Team, Team.id == Ticket.team_id)
        .join(WorkflowStatus, WorkflowStatus.id == Ticket.status_id)
        .where(TestCaseTicket.case_id.in_(ids))
        .order_by(Ticket.number)
    ).all():
        covers[case_id].append(
            CoveredTicket(
                id=ticket.id,
                identifier=f"{team.key}-{ticket.number}",
                title=ticket.title,
                type=ticket.type,
                status=StatusRead.model_validate(status),
            )
        )

    # Each case's latest result in a run (#275). Imported here: runs read
    # cases through this module.
    from lib_softtrack.runs import last_results

    results = last_results(session, ids)

    owner_ids = {case.owner_id for case in cases if case.owner_id}
    owners = {
        user.id: UserPublic.model_validate(user)
        for user in (
            session.exec(select(User).where(User.id.in_(owner_ids))).all()
            if owner_ids
            else []
        )
    }

    return [
        TestCaseRead(
            id=case.id,
            team_id=case.team_id,
            number=case.number,
            identifier=identifier(case),
            title=case.title,
            preconditions=case.preconditions,
            steps=[TestStep(**step) for step in case.steps or []],
            folder_id=case.folder_id,
            owner=owners.get(case.owner_id),
            state=case.state,
            version=case.version,
            labels=labels.get(case.id, []),
            covers=covers.get(case.id, []),
            last_result=results.get(case.id),
            created_at=case.created_at,
            updated_at=case.updated_at,
        )
        for case in cases
    ]


def _read(session: Session, case: TestCase) -> TestCaseRead:
    return _reads(session, [case])[0]


# --- folders ---------------------------------------------------------------


def _folder_read(folder: TestFolder, count: int) -> TestFolderRead:
    return TestFolderRead(
        id=folder.id, team_id=folder.team_id, name=folder.name, case_count=count
    )


def _counts(session: Session, team_id: int) -> dict[Optional[int], int]:
    return dict(
        session.exec(
            select(TestCase.folder_id, func.count())
            .where(
                TestCase.team_id == team_id,
                TestCase.state != TestCaseState.retired,
            )
            .group_by(TestCase.folder_id)
        ).all()
    )


def _free_folder_name(
    session: Session, team_id: int, name: str, except_id: Optional[int] = None
) -> str:
    for folder in session.exec(
        select(TestFolder).where(TestFolder.team_id == team_id)
    ).all():
        if folder.name.casefold() == name.casefold() and folder.id != except_id:
            raise api_error(
                status_code=409,
                code=ErrorCode.test_folder_name_taken,
                detail=f"There is already a folder called {folder.name}.",
            )
    return name


def list_folders(
    session: Session, current_user: User, team_id: int
) -> list[TestFolderRead]:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    counts = _counts(session, team_id)
    folders = session.exec(
        select(TestFolder)
        .where(TestFolder.team_id == team_id)
        .order_by(func.lower(TestFolder.name))
    ).all()
    return [_folder_read(folder, counts.get(folder.id, 0)) for folder in folders]


def create_folder(
    session: Session, current_user: User, team_id: int, payload: TestFolderCreate
) -> TestFolderRead:
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    folder = TestFolder(
        team_id=team_id, name=_free_folder_name(session, team_id, payload.name)
    )
    session.add(folder)
    session.commit()
    session.refresh(folder)
    return _folder_read(folder, 0)


def rename_folder(
    session: Session, current_user: User, folder_id: int, payload: TestFolderUpdate
) -> TestFolderRead:
    folder = get_folder_or_404(session, folder_id)
    require_team_member(folder.team_id, current_user, session)
    folder.name = _free_folder_name(session, folder.team_id, payload.name, folder.id)
    session.add(folder)
    session.commit()
    session.refresh(folder)
    return _folder_read(folder, _counts(session, folder.team_id).get(folder.id, 0))


def delete_folder(session: Session, current_user: User, folder_id: int) -> None:
    """Delete a folder. Its cases are kept, in no folder."""
    folder = get_folder_or_404(session, folder_id)
    require_team_member(folder.team_id, current_user, session)
    for case in session.exec(
        select(TestCase).where(TestCase.folder_id == folder_id)
    ).all():
        case.folder_id = None
        session.add(case)
    session.flush()
    session.delete(folder)
    session.commit()


# --- cases -----------------------------------------------------------------


def list_cases(
    session: Session,
    current_user: User,
    team_id: int,
    folder_id: Optional[int] = None,
    no_folder: bool = False,
    label_id: Optional[int] = None,
    state: Optional[TestCaseState] = None,
    q: Optional[str] = None,
) -> list[TestCaseRead]:
    """A team's cases, by number, narrowed by folder, label, state and words."""
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    clauses = [TestCase.team_id == team_id]
    if folder_id is not None:
        clauses.append(TestCase.folder_id == folder_id)
    elif no_folder:
        clauses.append(TestCase.folder_id.is_(None))
    if label_id is not None:
        clauses.append(
            TestCase.id.in_(
                select(TestCaseLabel.case_id).where(TestCaseLabel.label_id == label_id)
            )
        )
    if state is not None:
        clauses.append(TestCase.state == state)
    if q and q.strip():
        clauses.append(_matches(q))
    cases = session.exec(
        select(TestCase).where(*clauses).order_by(TestCase.number).limit(LIST_LIMIT)
    ).all()
    return _reads(session, list(cases))


def _matches(q: str):
    """A case whose key, title, preconditions or steps have the words in them."""
    needle = q.strip()
    key = re.fullmatch(r"(?i)tc-?(\d+)", needle)
    pattern = f"%{needle.lower()}%"
    clauses = [
        func.lower(TestCase.title).like(pattern),
        func.lower(func.coalesce(TestCase.preconditions, "")).like(pattern),
        func.lower(cast(TestCase.steps, String)).like(pattern),
    ]
    if key:
        clauses.append(TestCase.number == int(key.group(1)))
    return or_(*clauses)


def search_cases(
    session: Session, current_user: User, q: str, team_id: Optional[int] = None
) -> list[TestCaseHit]:
    """Cases on the caller's teams -- or one of them -- that search finds."""
    team_ids = list(
        session.exec(
            select(TeamMember.team_id).where(TeamMember.user_id == current_user.id)
        ).all()
    )
    if team_id is not None:
        require_team_member(team_id, current_user, session)
        team_ids = [team_id]
    if not team_ids or not q.strip():
        return []
    rows = session.exec(
        select(TestCase, Team)
        .join(Team, Team.id == TestCase.team_id)
        .where(TestCase.team_id.in_(team_ids), _matches(q))
        .order_by(TestCase.state == TestCaseState.retired, TestCase.updated_at.desc())
        .limit(20)
    ).all()
    return [
        TestCaseHit(
            id=case.id,
            team_id=case.team_id,
            team_key=team.key,
            identifier=identifier(case),
            title=case.title,
            state=case.state,
            folder_id=case.folder_id,
        )
        for case, team in rows
    ]


def _check(session: Session, team_id: int, data: dict) -> None:
    """The folder, owner, labels and tickets a case names, on its team."""
    _on_team(session, TestFolder, data.get("folder_id"), team_id, "folder")
    if data.get("owner_id") is not None:
        require_assignable(team_id, data["owner_id"], session)
    for ticket_id in data.get("ticket_ids") or []:
        _on_team(session, Ticket, ticket_id, team_id, "ticket")


def _version(
    session: Session, case: TestCase, author: User, note: Optional[str] = None
) -> None:
    session.add(
        TestCaseVersion(
            case_id=case.id,
            version=case.version,
            title=case.title,
            preconditions=case.preconditions,
            steps=list(case.steps or []),
            note=_text(note),
            author_id=author.id,
        )
    )


def create_case(
    session: Session, current_user: User, team_id: int, payload: TestCaseCreate
) -> TestCaseRead:
    team = get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    _check(session, team_id, payload.model_dump())
    label_ids = _labels_on_team(session, team_id, payload.label_ids)

    case = TestCase(
        team_id=team_id,
        number=team.next_test_case_number,
        title=payload.title,
        preconditions=_text(payload.preconditions),
        steps=_clean_steps(payload.steps),
        folder_id=payload.folder_id,
        owner_id=payload.owner_id,
        state=payload.state,
        created_by_id=current_user.id,
    )
    team.next_test_case_number += 1
    session.add(team)
    session.add(case)
    session.flush()
    _version(session, case, current_user)
    for label_id in label_ids:
        session.add(TestCaseLabel(case_id=case.id, label_id=label_id))
    for ticket_id in dict.fromkeys(payload.ticket_ids):
        session.add(TestCaseTicket(case_id=case.id, ticket_id=ticket_id))
    session.commit()
    session.refresh(case)
    return _read(session, case)


def get_case(session: Session, current_user: User, case_id: int) -> TestCaseRead:
    case = get_case_or_404(session, case_id)
    require_team_member(case.team_id, current_user, session)
    return _read(session, case)


def update_case(
    session: Session, current_user: User, case_id: int, payload: TestCaseUpdate
) -> TestCaseRead:
    case = get_case_or_404(session, case_id)
    require_team_member(case.team_id, current_user, session)
    data = payload.model_dump(exclude_unset=True)
    _check(session, case.team_id, data)

    text = {
        "title": data["title"] if data.get("title") is not None else case.title,
        "preconditions": (
            _text(data["preconditions"])
            if "preconditions" in data
            else case.preconditions
        ),
        "steps": (
            _clean_steps(payload.steps)
            if data.get("steps") is not None
            else case.steps or []
        ),
    }
    changed = any(text[field] != getattr(case, field) for field in _VERSIONED)
    for field, value in text.items():
        setattr(case, field, value)
    for field in ("folder_id", "owner_id"):
        if field in data:
            setattr(case, field, data[field])
    if data.get("state") is not None:
        case.state = data["state"]
    if changed:
        case.version += 1
        _version(session, case, current_user, data.get("change_note"))

    if data.get("label_ids") is not None:
        label_ids = _labels_on_team(session, case.team_id, data["label_ids"])
        session.exec(delete(TestCaseLabel).where(TestCaseLabel.case_id == case.id))
        for label_id in label_ids:
            session.add(TestCaseLabel(case_id=case.id, label_id=label_id))

    case.updated_at = utcnow()
    session.add(case)
    session.commit()
    session.refresh(case)
    return _read(session, case)


def delete_case(session: Session, current_user: User, case_id: int) -> None:
    """Delete a case nobody has run, with its versions, labels and what it
    covers. One a run executed (#275) is retired instead: its results keep
    saying what was tested."""
    case = get_case_or_404(session, case_id)
    require_team_member(case.team_id, current_user, session)
    ran = session.exec(select(func.count()).where(TestRunCase.case_id == case.id)).one()
    if ran:
        raise api_error(
            status_code=409,
            code=ErrorCode.test_case_has_runs,
            detail=f"{identifier(case)} has been run, and its results would say "
            "nothing without it. Retire it instead.",
        )
    for table in (TestCaseLabel, TestCaseTicket, TestCaseVersion):
        session.exec(delete(table).where(table.case_id == case.id))
    session.flush()
    session.delete(case)
    session.commit()


def list_versions(
    session: Session, current_user: User, case_id: int
) -> list[TestCaseVersionRead]:
    """Every version of a case's text, newest first."""
    case = get_case_or_404(session, case_id)
    require_team_member(case.team_id, current_user, session)
    rows = session.exec(
        select(TestCaseVersion, User)
        .outerjoin(User, User.id == TestCaseVersion.author_id)
        .where(TestCaseVersion.case_id == case.id)
        .order_by(TestCaseVersion.version.desc())
    ).all()
    return [
        TestCaseVersionRead(
            version=version.version,
            title=version.title,
            preconditions=version.preconditions,
            steps=[TestStep(**step) for step in version.steps or []],
            note=version.note,
            author=UserPublic.model_validate(author) if author else None,
            created_at=version.created_at,
        )
        for version, author in rows
    ]


# --- what a case covers ----------------------------------------------------


def cover(
    session: Session, current_user: User, case_id: int, ticket_id: int
) -> TestCaseRead:
    case = get_case_or_404(session, case_id)
    require_team_writer(case.team_id, current_user, session)
    _on_team(session, Ticket, ticket_id, case.team_id, "ticket")
    if session.get(TestCaseTicket, (case.id, ticket_id)) is not None:
        raise api_error(
            status_code=409,
            code=ErrorCode.test_case_covers_already,
            detail=f"{identifier(case)} covers that ticket already.",
        )
    session.add(TestCaseTicket(case_id=case.id, ticket_id=ticket_id))
    session.commit()
    return _read(session, case)


def uncover(session: Session, current_user: User, case_id: int, ticket_id: int) -> None:
    case = get_case_or_404(session, case_id)
    # The case's team, which the route's guard may have read as the ticket's.
    require_team_writer(case.team_id, current_user, session)
    link = session.get(TestCaseTicket, (case.id, ticket_id))
    if link is not None:
        session.delete(link)
        session.commit()


def ticket_cases(
    session: Session, current_user: User, ticket_id: int
) -> TicketTestCases:
    """The cases that cover a ticket, and whether its team keeps any."""
    ticket = session.get(Ticket, ticket_id)
    if ticket is None:
        raise api_error(
            status_code=404, code=ErrorCode.ticket_not_found, detail="Ticket not found"
        )
    require_team_member(ticket.team_id, current_user, session)
    uses = (
        session.exec(
            select(func.count()).where(
                TestCase.team_id == ticket.team_id,
                TestCase.state != TestCaseState.retired,
            )
        ).one()
        > 0
    )
    cases = session.exec(
        select(TestCase)
        .join(TestCaseTicket, TestCaseTicket.case_id == TestCase.id)
        .where(
            TestCaseTicket.ticket_id == ticket.id,
            TestCase.state != TestCaseState.retired,
        )
        .order_by(TestCase.number)
    ).all()
    from lib_softtrack.runs import last_results

    results = last_results(session, [case.id for case in cases])
    return TicketTestCases(
        uses_test_cases=uses,
        cases=[
            TicketTestCase(
                id=case.id,
                identifier=identifier(case),
                title=case.title,
                state=case.state,
                last_result=results.get(case.id),
            )
            for case in cases
        ],
    )


def forget_ticket(session: Session, ticket_id: int) -> None:
    """A ticket is going -- purged, or moved to a team the cases are not
    on: no case covers it any more. Nothing is committed."""
    session.exec(delete(TestCaseTicket).where(TestCaseTicket.ticket_id == ticket_id))


# --- CSV -------------------------------------------------------------------

#: The export's columns, in order. Append, do not rearrange: people build
#: spreadsheets on an export. The import reads the same columns back.
CSV_COLUMNS = [
    "key",
    "title",
    "folder",
    "state",
    "owner",
    "labels",
    "preconditions",
    "steps",
    "expected",
    "covers",
]

_NUMBERED = re.compile(r"^\s*(\d+)[.)]\s?(.*)$")


def _numbered(lines: list[str]) -> str:
    """Steps as one cell a person can read: "1. Open Invoices." a line."""
    return "\n".join(f"{n}. {line}" for n, line in enumerate(lines, start=1))


def _unnumbered(cell: str) -> dict[int, str]:
    """A numbered cell read back: `{1: "Open Invoices.", ...}`. A line with no
    number carries on the one before it."""
    found: dict[int, str] = {}
    last: Optional[int] = None
    for line in (cell or "").splitlines():
        match = _NUMBERED.match(line)
        if match:
            last = int(match.group(1))
            found[last] = match.group(2).strip()
        elif last is not None and line.strip():
            found[last] = f"{found[last]} {line.strip()}".strip()
        elif line.strip():
            last = len(found) + 1
            found[last] = line.strip()
    return found


def export_cases(session: Session, current_user: User, team_id: int) -> Iterator[bytes]:
    """Every case on the team, as CSV, by number."""
    get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    folders = {
        folder.id: folder.name
        for folder in session.exec(
            select(TestFolder).where(TestFolder.team_id == team_id)
        ).all()
    }
    cases = list(
        session.exec(
            select(TestCase)
            .where(TestCase.team_id == team_id)
            .order_by(TestCase.number)
        ).all()
    )
    reads = _reads(session, cases)

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(CSV_COLUMNS)
    for case in reads:
        writer.writerow(
            [
                case.identifier,
                safe_text(case.title),
                safe_text(folders.get(case.folder_id, "")),
                case.state.value,
                (case.owner.username or "") if case.owner else "",
                safe_text(";".join(label.name for label in case.labels)),
                safe_text(case.preconditions or ""),
                safe_text(_numbered([step.action for step in case.steps])),
                safe_text(_numbered([step.expected for step in case.steps])),
                ";".join(ticket.identifier for ticket in case.covers),
            ]
        )
    yield (BOM + buffer.getvalue()).encode("utf-8")


def import_cases(
    session: Session,
    current_user: User,
    team_id: int,
    content: str,
    dry_run: bool = True,
) -> TestCaseImport:
    """Cases from a CSV in the export's shape: a case a row.

    A row whose key is a case the team has is left alone, so an export can be
    imported back -- or an import retried -- without making the cases twice.
    Folders are made by name; labels, the owner and covered tickets are
    matched to the team's own and left out, with a warning, when they are not
    there. A dry run does it all and rolls back, as the Jira import does.
    """
    team = get_team_or_404(team_id, session)
    require_team_member(team_id, current_user, session)
    reader = csv.DictReader(io.StringIO(content.lstrip(BOM)))
    if not reader.fieldnames or "title" not in [
        name.strip().lower() for name in reader.fieldnames
    ]:
        raise api_error(
            status_code=422,
            code=ErrorCode.test_cases_import_invalid,
            detail="No 'title' column found. Export the team's test cases to "
            "see the columns an import reads.",
        )

    taken = set(
        session.exec(select(TestCase.number).where(TestCase.team_id == team_id)).all()
    )
    folders = {
        folder.name.casefold(): folder
        for folder in session.exec(
            select(TestFolder).where(TestFolder.team_id == team_id)
        ).all()
    }
    labels = {
        label.name.casefold(): label
        for label in session.exec(select(Label).where(Label.team_id == team_id)).all()
    }
    people = {
        key.casefold(): user
        for user in session.exec(
            select(User)
            .join(TeamMember, TeamMember.user_id == User.id)
            .where(TeamMember.team_id == team_id)
        ).all()
        for key in (user.username, user.email)
        if key
    }
    tickets = {
        f"{team.key}-{ticket.number}".casefold(): ticket
        for ticket in session.exec(
            select(Ticket).where(Ticket.team_id == team_id)
        ).all()
    }

    report = TestCaseImport(
        dry_run=dry_run,
        cases_found=0,
        cases_created=0,
        cases_skipped_existing=0,
        folders_created=[],
        warnings=[],
    )
    unknown_labels: set[str] = set()
    unknown_people: set[str] = set()
    unknown_tickets: set[str] = set()

    for raw in reader:
        row = {
            (key or "").strip().lower(): (value or "").strip()
            for key, value in raw.items()
        }
        title = row.get("title", "")
        if not title:
            continue
        report.cases_found += 1
        key = re.fullmatch(r"(?i)tc-?(\d+)", row.get("key", ""))
        if key and int(key.group(1)) in taken:
            report.cases_skipped_existing += 1
            continue

        folder = None
        if row.get("folder"):
            folder = folders.get(row["folder"].casefold())
            if folder is None:
                folder = TestFolder(team_id=team_id, name=row["folder"][:60])
                session.add(folder)
                session.flush()
                folders[folder.name.casefold()] = folder
                report.folders_created.append(folder.name)

        actions = _unnumbered(row.get("steps", ""))
        expected = _unnumbered(row.get("expected", ""))
        steps = [
            TestStep(action=actions.get(n, ""), expected=expected.get(n, ""))
            for n in sorted(set(actions) | set(expected))
        ][:50]

        owner = None
        if row.get("owner"):
            owner = people.get(row["owner"].casefold())
            if owner is None:
                unknown_people.add(row["owner"])

        label_ids = []
        for name in filter(
            None, (part.strip() for part in row.get("labels", "").split(";"))
        ):
            label = labels.get(name.casefold())
            if label is None:
                unknown_labels.add(name)
            else:
                label_ids.append(label.id)

        ticket_ids = []
        for ref in filter(
            None, (part.strip() for part in row.get("covers", "").split(";"))
        ):
            ticket = tickets.get(ref.casefold())
            if ticket is None:
                unknown_tickets.add(ref)
            else:
                ticket_ids.append(ticket.id)

        try:
            state = TestCaseState((row.get("state") or "draft").lower())
        except ValueError:
            state = TestCaseState.draft

        case = TestCase(
            team_id=team_id,
            number=team.next_test_case_number,
            title=title[:200],
            preconditions=row.get("preconditions") or None,
            steps=_clean_steps(steps),
            folder_id=folder.id if folder else None,
            owner_id=owner.id if owner else None,
            state=state,
            created_by_id=current_user.id,
        )
        team.next_test_case_number += 1
        session.add(team)
        session.add(case)
        session.flush()
        _version(session, case, current_user, "Imported")
        for label_id in dict.fromkeys(label_ids):
            session.add(TestCaseLabel(case_id=case.id, label_id=label_id))
        for ticket_id in dict.fromkeys(ticket_ids):
            session.add(TestCaseTicket(case_id=case.id, ticket_id=ticket_id))
        report.cases_created += 1

    def warn(things: set[str], sentence: str) -> None:
        if things:
            names = sorted(things)
            report.warnings.append(
                sentence + ", ".join(names[:5]) + ("…" if len(names) > 5 else "")
            )

    warn(unknown_labels, "These labels are not on the team, and were left off: ")
    warn(
        unknown_people, "These people are not on the team, so the cases have no owner: "
    )
    warn(unknown_tickets, "These tickets are not on the team, so nothing covers them: ")

    if dry_run:
        session.rollback()
    else:
        session.commit()
    return report
