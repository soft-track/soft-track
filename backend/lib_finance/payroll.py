"""Payroll runs (#132): a pay period generated, reviewed, approved, exported.

A run is one period on one pay schedule. What it would pay is worked out
while it is a draft and written down when it is approved:

- **Draft.** Its lines are read live: everybody active whose pay in effect on
  the period's last day is on this schedule, and everybody active with no pay
  in effect at all -- listed as missing, never skipped, because a run that
  quietly pays fewer people than work here is the worst kind of wrong. A pay
  recorded, or an account opened, after the run was generated is on it; a
  line takes a one-off adjustment with a note.
- **Approved.** Every line is written with its amount, currency, record and
  department copied onto it. Nothing that happens to anybody's pay or
  department afterwards changes it, and only now can it be exported.
- **Paid.** A finance admin says the money went out.

A run can also carry approved expense claims (#137), each person's as a line
of its own beside their pay -- never merged into it -- in the run and in its
CSV. Marking the run paid is what pays those claims back.

The pay on the period's last day, not a share of the month: a raise halfway
through is an adjustment somebody decides, not a proration SoftTrack guesses.
"""

from dataclasses import dataclass
from typing import Iterator, Optional

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, func, select

from lib_finance.compensation import pay_on
from lib_finance.models.money import FinancePerson
from lib_finance.models.payroll import (
    PayrollAdjustment,
    PayrollLineRead,
    PayrollReimbursementRead,
    PayrollRunCreate,
    PayrollRunPage,
    PayrollRunRead,
    PayrollRunSummary,
    PayrollTotal,
)
from lib_finance.money import MINOR_UNITS, Currency
from lib_identity.models.departments import DepartmentRef
from lib_identity.models.identity import PersonRef
from lib_softtrack.models.page import DEFAULT_LIMIT
from lib_softtrack.tables import (
    Department,
    Expense,
    PayrollLine,
    PayrollRun,
    PayrollRunState,
    User,
    utcnow,
)
from lib_utils.errors import ErrorCode, api_error

#: The columns of a run's CSV, in order: what a bank template or a payroll
#: bureau takes. Append, do not rearrange -- people build on exports. `kind`
#: (#137) says which rows are pay and which pay back expense claims.
CSV_COLUMNS = ["name", "amount", "currency", "period_start", "period_end", "kind"]


@dataclass
class _Line:
    person: User
    department: Optional[Department]
    compensation_id: Optional[int]
    amount_minor: Optional[int]
    currency: Optional[str]
    adjustment_minor: int
    adjustment_note: Optional[str]

    @property
    def missing(self) -> bool:
        return self.amount_minor is None

    @property
    def total_minor(self) -> Optional[int]:
        if self.amount_minor is None:
            return None
        return self.amount_minor + self.adjustment_minor


def _sorted(lines: list[_Line]) -> list[_Line]:
    """Paid lines by name, then the missing ones by name."""
    return sorted(
        lines,
        key=lambda line: (line.missing, line.person.full_name.lower(), line.person.id),
    )


def _draft_lines(session: Session, run: PayrollRun) -> list[_Line]:
    people = session.exec(
        select(User)
        .where(
            User.is_active == True,  # noqa: E712 -- SQL comparison
            # Off the books (#243): somebody from outside is nobody's payroll.
            User.is_external == False,  # noqa: E712
        )
        .options(selectinload(User.department))
    ).all()
    pay = pay_on(session, [person.id for person in people], run.period_end)
    adjustments = {
        row.user_id: row
        for row in session.exec(select(PayrollLine).where(PayrollLine.run_id == run.id))
    }
    lines = []
    for person in people:
        record = pay.get(person.id)
        if record is not None and record.pay_schedule != run.pay_schedule:
            continue  # On the other schedule's run.
        adjustment = adjustments.get(person.id) if record is not None else None
        lines.append(
            _Line(
                person=person,
                department=person.department,
                compensation_id=record.id if record else None,
                amount_minor=record.amount_minor if record else None,
                currency=record.currency if record else None,
                adjustment_minor=adjustment.adjustment_minor if adjustment else 0,
                adjustment_note=adjustment.adjustment_note if adjustment else None,
            )
        )
    return _sorted(lines)


def _frozen_lines(session: Session, run: PayrollRun) -> list[_Line]:
    rows = session.exec(
        select(PayrollLine)
        .where(PayrollLine.run_id == run.id)
        .options(selectinload(PayrollLine.user), selectinload(PayrollLine.department))
    ).all()
    return _sorted(
        [
            _Line(
                person=row.user,
                department=row.department,
                compensation_id=row.compensation_id,
                amount_minor=row.amount_minor,
                currency=row.currency,
                adjustment_minor=row.adjustment_minor,
                adjustment_note=row.adjustment_note,
            )
            for row in rows
        ]
    )


def _lines(session: Session, run: PayrollRun) -> list[_Line]:
    if run.state is PayrollRunState.draft:
        return _draft_lines(session, run)
    return _frozen_lines(session, run)


@dataclass
class _Tally:
    """A run's totals per currency, and how many lines and missing ones."""

    totals: list[PayrollTotal]
    line_count: int
    missing_count: int

    @classmethod
    def of(cls, lines: list[_Line]) -> "_Tally":
        sums: dict[str, list[int]] = {}
        for line in lines:
            if line.total_minor is not None:
                total = sums.setdefault(line.currency, [0, 0])
                total[0] += line.total_minor
                total[1] += 1
        return cls(
            totals=[
                PayrollTotal(currency=currency, amount_minor=amount, lines=count)
                for currency, (amount, count) in sorted(sums.items())
            ],
            line_count=len(lines),
            missing_count=sum(1 for line in lines if line.missing),
        )


def _frozen_tallies(session: Session, run_ids: list[int]) -> dict[int, _Tally]:
    """Approved and paid runs summed by the database, a page of runs at
    once. A missing line is the group with no currency."""
    tallies = {run_id: _Tally([], 0, 0) for run_id in run_ids}
    rows = session.exec(
        select(
            PayrollLine.run_id,
            PayrollLine.currency,
            func.sum(PayrollLine.amount_minor + PayrollLine.adjustment_minor),
            func.count(),
        )
        .where(col(PayrollLine.run_id).in_(run_ids or [0]))
        .group_by(PayrollLine.run_id, PayrollLine.currency)
        .order_by(PayrollLine.run_id, PayrollLine.currency)
    ).all()
    for run_id, currency, amount, count in rows:
        tally = tallies[run_id]
        tally.line_count += count
        if currency is None:
            tally.missing_count += count
        else:
            tally.totals.append(
                PayrollTotal(currency=currency, amount_minor=amount, lines=count)
            )
    return tallies


def _reimbursement_rows(session: Session, run_id: int):
    """The claims a run carries (#137), per person per currency."""
    return session.exec(
        select(
            Expense.submitter_id,
            Expense.currency,
            func.sum(Expense.amount_minor),
            func.count(),
        )
        .where(Expense.payroll_run_id == run_id)
        .group_by(Expense.submitter_id, Expense.currency)
    ).all()


def _reimbursements(session: Session, run_id: int) -> list[PayrollReimbursementRead]:
    rows = _reimbursement_rows(session, run_id)
    people = {
        person.id: person
        for person in session.exec(
            select(User)
            .where(col(User.id).in_([row[0] for row in rows] or [0]))
            .options(selectinload(User.department))
        )
    }
    return sorted(
        (
            PayrollReimbursementRead(
                person=FinancePerson.model_validate(people[user_id]),
                currency=currency,
                amount_minor=amount,
                claims=count,
            )
            for user_id, currency, amount, count in rows
        ),
        key=lambda line: (line.person.full_name.lower(), line.currency.value),
    )


def _reimbursement_totals(
    session: Session, run_ids: list[int]
) -> dict[int, list[PayrollTotal]]:
    """What each run pays back, per currency, a page of runs at once."""
    totals: dict[int, list[PayrollTotal]] = {run_id: [] for run_id in run_ids}
    rows = session.exec(
        select(
            Expense.payroll_run_id,
            Expense.currency,
            func.sum(Expense.amount_minor),
            func.count(),
        )
        .where(col(Expense.payroll_run_id).in_(run_ids or [0]))
        .group_by(Expense.payroll_run_id, Expense.currency)
        .order_by(Expense.payroll_run_id, Expense.currency)
    ).all()
    for run_id, currency, amount, count in rows:
        totals[run_id].append(
            PayrollTotal(currency=currency, amount_minor=amount, lines=count)
        )
    return totals


def _person(user: Optional[User]) -> Optional[PersonRef]:
    return PersonRef.model_validate(user) if user is not None else None


def _summary(
    run: PayrollRun, tally: _Tally, reimbursed: list[PayrollTotal]
) -> PayrollRunSummary:
    return PayrollRunSummary(
        id=run.id,
        pay_schedule=run.pay_schedule,
        period_start=run.period_start,
        period_end=run.period_end,
        state=run.state,
        created_by=_person(run.created_by),
        created_at=run.created_at,
        approved_by=_person(run.approved_by),
        approved_at=run.approved_at,
        paid_by=_person(run.paid_by),
        paid_at=run.paid_at,
        totals=tally.totals,
        line_count=tally.line_count,
        missing_count=tally.missing_count,
        reimbursement_totals=reimbursed,
    )


def _read(session: Session, run: PayrollRun) -> PayrollRunRead:
    lines = _lines(session, run)
    reimbursements = _reimbursements(session, run.id)
    reimbursed: dict[str, list[int]] = {}
    for line in reimbursements:
        total = reimbursed.setdefault(line.currency.value, [0, 0])
        total[0] += line.amount_minor
        total[1] += line.claims
    return PayrollRunRead(
        **_summary(
            run,
            _Tally.of(lines),
            [
                PayrollTotal(currency=currency, amount_minor=amount, lines=count)
                for currency, (amount, count) in sorted(reimbursed.items())
            ],
        ).model_dump(),
        reimbursements=reimbursements,
        lines=[
            PayrollLineRead(
                person=FinancePerson.model_validate(line.person),
                department=(
                    DepartmentRef.model_validate(line.department)
                    if line.department
                    else None
                ),
                compensation_id=line.compensation_id,
                amount_minor=line.amount_minor,
                currency=line.currency,
                total_minor=line.total_minor,
                adjustment_minor=line.adjustment_minor,
                adjustment_note=line.adjustment_note,
                missing=line.missing,
            )
            for line in lines
        ],
    )


def _run_or_404(session: Session, run_id: int) -> PayrollRun:
    run = session.get(PayrollRun, run_id)
    if run is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.payroll_run_not_found,
            detail="Payroll run not found",
        )
    return run


def _draft_or_409(session: Session, run_id: int) -> PayrollRun:
    run = _run_or_404(session, run_id)
    if run.state is not PayrollRunState.draft:
        raise api_error(
            status_code=409,
            code=ErrorCode.payroll_run_not_draft,
            detail="This run has been approved, and an approved run does not change",
        )
    return run


def list_runs(
    session: Session, limit: int = DEFAULT_LIMIT, offset: int = 0
) -> PayrollRunPage:
    """The newest period first; runs for the same period by schedule."""
    total = session.exec(select(func.count()).select_from(PayrollRun)).one()
    runs = session.exec(
        select(PayrollRun)
        .options(
            selectinload(PayrollRun.created_by),
            selectinload(PayrollRun.approved_by),
            selectinload(PayrollRun.paid_by),
        )
        .order_by(col(PayrollRun.period_start).desc(), PayrollRun.pay_schedule)
        .limit(limit)
        .offset(offset)
    ).all()
    # Drafts are worked out, like their pages; everything else was written
    # down at approval, and is summed where it is kept.
    frozen = _frozen_tallies(
        session, [run.id for run in runs if run.state is not PayrollRunState.draft]
    )
    reimbursed = _reimbursement_totals(session, [run.id for run in runs])
    return PayrollRunPage(
        items=[
            _summary(
                run,
                (
                    _Tally.of(_draft_lines(session, run))
                    if run.state is PayrollRunState.draft
                    else frozen[run.id]
                ),
                reimbursed[run.id],
            )
            for run in runs
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


def get_run(session: Session, run_id: int) -> PayrollRunRead:
    return _read(session, _run_or_404(session, run_id))


def create_run(
    session: Session, actor: User, payload: PayrollRunCreate
) -> PayrollRunRead:
    """Generate a run: a draft for one period on one schedule."""
    _refuse_an_overlap(session, payload)
    run = PayrollRun(
        pay_schedule=payload.pay_schedule,
        period_start=payload.period_start,
        period_end=payload.period_end,
        created_by_id=actor.id,
    )
    session.add(run)
    try:
        session.commit()
    except IntegrityError:
        # Two runs for the same start at once: the constraint decides.
        session.rollback()
        _refuse_an_overlap(session, payload)
        raise
    session.refresh(run)
    return _read(session, run)


def _refuse_an_overlap(session: Session, payload: PayrollRunCreate) -> None:
    other = session.exec(
        select(PayrollRun).where(
            PayrollRun.pay_schedule == payload.pay_schedule,
            PayrollRun.period_start <= payload.period_end,
            PayrollRun.period_end >= payload.period_start,
        )
    ).first()
    if other is not None:
        raise api_error(
            status_code=409,
            code=ErrorCode.payroll_run_overlaps,
            detail=(
                f"A {other.pay_schedule.value.replace('_', '-')} run already covers "
                f"{other.period_start.isoformat()} to {other.period_end.isoformat()}"
            ),
        )


def delete_run(session: Session, run_id: int) -> None:
    """Throw away a draft -- one generated for the wrong period, say. An
    approved run is a record, and stays."""
    run = _draft_or_409(session, run_id)
    for row in session.exec(select(PayrollLine).where(PayrollLine.run_id == run.id)):
        session.delete(row)
    # Claims it was to carry go back to awaiting reimbursement (#137).
    session.exec(
        update(Expense)
        .where(Expense.payroll_run_id == run.id)
        .values(payroll_run_id=None)
    )
    session.delete(run)
    session.commit()


def set_adjustment(
    session: Session, run_id: int, user_id: int, payload: PayrollAdjustment
) -> PayrollRunRead:
    run = _draft_or_409(session, run_id)
    line = next(
        (line for line in _draft_lines(session, run) if line.person.id == user_id),
        None,
    )
    if line is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.payroll_line_not_found,
            detail="That person is not on this run",
        )
    if line.amount_minor is None:
        raise api_error(
            status_code=409,
            code=ErrorCode.payroll_line_missing_pay,
            detail="Record their pay before adjusting their line",
        )
    if line.amount_minor + payload.amount_minor < 0:
        raise api_error(
            status_code=400,
            code=ErrorCode.payroll_adjustment_too_large,
            detail="An adjustment cannot take a line below zero",
        )
    row = session.exec(
        select(PayrollLine).where(
            PayrollLine.run_id == run.id, PayrollLine.user_id == user_id
        )
    ).first() or PayrollLine(run_id=run.id, user_id=user_id)
    row.adjustment_minor = payload.amount_minor
    row.adjustment_note = payload.note
    session.add(row)
    session.commit()
    return _read(session, run)


def clear_adjustment(session: Session, run_id: int, user_id: int) -> PayrollRunRead:
    run = _draft_or_409(session, run_id)
    row = session.exec(
        select(PayrollLine).where(
            PayrollLine.run_id == run.id, PayrollLine.user_id == user_id
        )
    ).first()
    if row is not None:
        # In a draft a row is only ever an adjustment.
        session.delete(row)
        session.commit()
    return _read(session, run)


def approve(session: Session, actor: User, run_id: int) -> PayrollRunRead:
    """Freeze the run: every line written with what it pays.

    An adjustment whose person is no longer on the run -- deactivated, or
    moved to another schedule, since it was made -- goes with them.
    """
    run = _draft_or_409(session, run_id)
    rows = {
        row.user_id: row
        for row in session.exec(select(PayrollLine).where(PayrollLine.run_id == run.id))
    }
    for line in _draft_lines(session, run):
        row = rows.pop(line.person.id, None) or PayrollLine(
            run_id=run.id, user_id=line.person.id
        )
        row.compensation_id = line.compensation_id
        row.amount_minor = line.amount_minor
        row.currency = line.currency
        row.department_id = line.person.department_id
        session.add(row)
    for orphan in rows.values():
        session.delete(orphan)
    run.state = PayrollRunState.approved
    run.approved_by_id = actor.id
    run.approved_at = utcnow()
    session.add(run)
    session.commit()
    session.refresh(run)
    return _read(session, run)


def mark_paid(session: Session, actor: User, run_id: int) -> PayrollRunRead:
    """Say the money went out. SoftTrack does not send it; this records that
    whatever does, did."""
    run = _run_or_404(session, run_id)
    if run.state is not PayrollRunState.approved:
        raise api_error(
            status_code=409,
            code=ErrorCode.payroll_run_not_approved,
            detail="Only an approved run can be marked paid",
        )
    run.state = PayrollRunState.paid
    run.paid_by_id = actor.id
    run.paid_at = utcnow()
    session.add(run)
    # The claims it carried are paid back now, and their submitters see it.
    session.exec(
        update(Expense)
        .where(Expense.payroll_run_id == run.id)
        .values(reimbursed_at=run.paid_at)
    )
    session.commit()
    session.refresh(run)
    return _read(session, run)


def decimal(amount_minor: int, currency: str) -> str:
    """830000 in USD as "8300.00": the currency's own decimals, no symbol,
    no grouping -- what a bank template reads."""
    places = MINOR_UNITS[Currency(currency)]
    if places == 0:
        return str(amount_minor)
    sign = "-" if amount_minor < 0 else ""
    whole, fraction = divmod(abs(amount_minor), 10**places)
    return f"{sign}{whole}.{fraction:0{places}d}"


def export_rows(
    session: Session, run_id: int
) -> tuple[PayrollRun, Iterator[list[str]]]:
    """The run as CSV rows, header first. Approved or paid runs only: the
    export is the product, and the approval is what makes it one. Missing
    lines are not in it -- there is nothing to pay them."""
    run = _run_or_404(session, run_id)
    if run.state is PayrollRunState.draft:
        raise api_error(
            status_code=409,
            code=ErrorCode.payroll_run_not_approved,
            detail="Approve the run before exporting it",
        )
    lines = [line for line in _frozen_lines(session, run) if not line.missing]
    reimbursements = _reimbursements(session, run.id)
    period = [run.period_start.isoformat(), run.period_end.isoformat()]

    def rows() -> Iterator[list[str]]:
        yield CSV_COLUMNS
        # Each person's pay, then what the run pays them back: rows of their
        # own, so nobody reading the file mistakes a claim for salary.
        entries = [
            (line.person.full_name, 0, line.currency, line.total_minor, "wages")
            for line in lines
        ] + [
            (
                line.person.full_name,
                1,
                line.currency.value,
                line.amount_minor,
                "reimbursement",
            )
            for line in reimbursements
        ]
        for name, _, currency, amount, kind in sorted(
            entries, key=lambda entry: (entry[0].lower(), entry[1], entry[2])
        ):
            yield [name, decimal(amount, currency), currency, *period, kind]

    return run, rows()
