"""Reimbursements (#137): approved claims paid back, exactly once, visibly.

An approved expense is a debt: the company agrees it owes the money.
Reimbursement is the debt settled, and the gap between the two is where trust
erodes -- claims that sit "approved" for six weeks with nobody able to say when
the money moves. So an approved claim goes out one of two ways:

- **In a batch** of its own, gathered by a finance admin and moved draft ->
  approved -> paid like a payroll run, with a CSV per person per currency in
  the same bank template.
- **On a payroll run**, as a line of its own beside the person's pay --
  common practice, and never merged into the wages.

Either way the claim records which, on its own row, and the row allows only
one: see the check constraints on `Expense`. When the batch or run is marked
paid the claim says so, and its submitter sees "Reimbursed" rather than
"Approved". No partial reimbursements: a claim paid in part is a decision,
which is a refusal and a corrected claim, not a remainder.
"""

from collections import defaultdict
from datetime import date
from typing import Iterator, Optional

from sqlalchemy import update
from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, func, select

from lib_finance import payroll
from lib_finance.expenses import SETTLEMENT_LOADS, claim_read
from lib_finance.models.expenses import ClaimRead
from lib_finance.models.money import FinancePerson
from lib_finance.models.payroll import PayrollRunRead
from lib_finance.models.reimbursements import (
    BatchLine,
    BatchTotal,
    ReimbursementBatchPage,
    ReimbursementBatchRead,
    ReimbursementBatchSummary,
)
from lib_finance.payroll import CSV_COLUMNS, decimal
from lib_identity.models.identity import PersonRef
from lib_softtrack.models.page import DEFAULT_LIMIT
from lib_softtrack.tables import (
    Expense,
    ExpenseState,
    PayrollRunState,
    ReimbursementBatch,
    User,
    utcnow,
)
from lib_utils.errors import ErrorCode, api_error


def label(batch_id: int) -> str:
    return f"RB-{batch_id}"


def _claims_query():
    return select(Expense).options(
        selectinload(Expense.submitter).selectinload(User.department),
        selectinload(Expense.decided_by),
        selectinload(Expense.department),
        *SETTLEMENT_LOADS,
    )


def awaiting(session: Session) -> list[ClaimRead]:
    """Every approved claim not paid back yet, the longest waiting first --
    including those already in a draft batch or on a draft run, which say
    where, so nobody gathers them twice."""
    rows = session.exec(
        _claims_query()
        .where(
            Expense.state == ExpenseState.approved,
            col(Expense.reimbursed_at).is_(None),
        )
        .order_by(Expense.decided_at, Expense.id)
    ).all()
    return [claim_read(row) for row in rows]


def _where(expense: Expense) -> str:
    if expense.reimbursement_batch_id is not None:
        return f"in {label(expense.reimbursement_batch_id)}"
    return "on a payroll run"


def _settleable(session: Session, expense_ids: list[int]) -> list[Expense]:
    """The claims, if every one is approved and not already going out."""
    wanted = sorted(set(expense_ids))
    rows = session.exec(select(Expense).where(col(Expense.id).in_(wanted))).all()
    if len(rows) != len(wanted):
        raise api_error(
            status_code=404,
            code=ErrorCode.expense_not_found,
            detail="Expense claim not found",
        )
    for expense in rows:
        if expense.state is not ExpenseState.approved:
            raise api_error(
                status_code=409,
                code=ErrorCode.expense_not_approved,
                detail=f"“{expense.description}” has not been approved, so nothing "
                "is owed for it",
            )
        if expense.reimbursement_batch_id or expense.payroll_run_id:
            raise api_error(
                status_code=409,
                code=ErrorCode.expense_already_settled,
                detail=f"“{expense.description}” is already {_where(expense)}. "
                "A claim is paid back once",
            )
    return list(rows)


# --- Batches ---------------------------------------------------------------------


def _batch_or_404(session: Session, batch_id: int) -> ReimbursementBatch:
    batch = session.get(ReimbursementBatch, batch_id)
    if batch is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.reimbursement_batch_not_found,
            detail="Reimbursement batch not found",
        )
    return batch


def _draft_batch_or_409(session: Session, batch_id: int) -> ReimbursementBatch:
    batch = _batch_or_404(session, batch_id)
    if batch.state is not PayrollRunState.draft:
        raise api_error(
            status_code=409,
            code=ErrorCode.reimbursement_batch_not_draft,
            detail=f"{label(batch.id)} has been approved, and an approved batch "
            "does not change",
        )
    return batch


def _person(user: Optional[User]) -> Optional[PersonRef]:
    return PersonRef.model_validate(user) if user is not None else None


def _summaries(
    session: Session, batches: list[ReimbursementBatch]
) -> list[ReimbursementBatchSummary]:
    """Batches with their totals, summed by the database a page at a time."""
    ids = [batch.id for batch in batches]
    sums: dict[int, list[BatchTotal]] = defaultdict(list)
    claims: dict[int, int] = defaultdict(int)
    for batch_id, currency, amount, count in session.exec(
        select(
            Expense.reimbursement_batch_id,
            Expense.currency,
            func.sum(Expense.amount_minor),
            func.count(),
        )
        .where(col(Expense.reimbursement_batch_id).in_(ids or [0]))
        .group_by(Expense.reimbursement_batch_id, Expense.currency)
        .order_by(Expense.reimbursement_batch_id, Expense.currency)
    ):
        sums[batch_id].append(
            BatchTotal(currency=currency, amount_minor=amount, claims=count)
        )
        claims[batch_id] += count
    people = dict(
        session.exec(
            select(
                Expense.reimbursement_batch_id,
                func.count(func.distinct(Expense.submitter_id)),
            )
            .where(col(Expense.reimbursement_batch_id).in_(ids or [0]))
            .group_by(Expense.reimbursement_batch_id)
        ).all()
    )
    return [
        ReimbursementBatchSummary(
            id=batch.id,
            label=label(batch.id),
            state=batch.state,
            created_by=_person(batch.created_by),
            created_at=batch.created_at,
            approved_by=_person(batch.approved_by),
            approved_at=batch.approved_at,
            paid_by=_person(batch.paid_by),
            paid_at=batch.paid_at,
            totals=sums[batch.id],
            claim_count=claims[batch.id],
            people_count=people.get(batch.id, 0),
        )
        for batch in batches
    ]


def _batch_claims(session: Session, batch_id: int) -> list[Expense]:
    return list(
        session.exec(
            _claims_query()
            .where(Expense.reimbursement_batch_id == batch_id)
            .order_by(Expense.incurred_on, Expense.id)
        ).all()
    )


def _lines(claims: list[Expense]) -> list[BatchLine]:
    """Per person per currency: what the batch pays each of them back."""
    grouped: dict[tuple[int, str], list[Expense]] = defaultdict(list)
    for claim in claims:
        grouped[(claim.submitter_id, claim.currency)].append(claim)
    lines = [
        BatchLine(
            person=FinancePerson.model_validate(rows[0].submitter),
            currency=currency,
            amount_minor=sum(row.amount_minor for row in rows),
            claims=len(rows),
        )
        for (_, currency), rows in grouped.items()
    ]
    return sorted(
        lines, key=lambda line: (line.person.full_name.lower(), line.currency.value)
    )


def _read_batch(session: Session, batch: ReimbursementBatch) -> ReimbursementBatchRead:
    claims = _batch_claims(session, batch.id)
    [summary] = _summaries(session, [batch])
    return ReimbursementBatchRead(
        **summary.model_dump(),
        lines=_lines(claims),
        claims=[claim_read(claim) for claim in claims],
    )


def list_batches(
    session: Session, limit: int = DEFAULT_LIMIT, offset: int = 0
) -> ReimbursementBatchPage:
    """The newest first."""
    total = session.exec(select(func.count()).select_from(ReimbursementBatch)).one()
    batches = session.exec(
        select(ReimbursementBatch)
        .options(
            selectinload(ReimbursementBatch.created_by),
            selectinload(ReimbursementBatch.approved_by),
            selectinload(ReimbursementBatch.paid_by),
        )
        .order_by(col(ReimbursementBatch.id).desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return ReimbursementBatchPage(
        items=_summaries(session, list(batches)),
        total=total,
        limit=limit,
        offset=offset,
    )


def get_batch(session: Session, batch_id: int) -> ReimbursementBatchRead:
    return _read_batch(session, _batch_or_404(session, batch_id))


def create_batch(
    session: Session, actor: User, expense_ids: list[int]
) -> ReimbursementBatchRead:
    """Gather approved claims into a draft batch."""
    claims = _settleable(session, expense_ids)
    batch = ReimbursementBatch(created_by_id=actor.id)
    session.add(batch)
    session.flush()
    for claim in claims:
        claim.reimbursement_batch_id = batch.id
        session.add(claim)
    session.commit()
    session.refresh(batch)
    return _read_batch(session, batch)


def delete_batch(session: Session, batch_id: int) -> None:
    """Throw a draft away; its claims go back to awaiting."""
    batch = _draft_batch_or_409(session, batch_id)
    session.exec(
        update(Expense)
        .where(Expense.reimbursement_batch_id == batch.id)
        .values(reimbursement_batch_id=None)
    )
    session.delete(batch)
    session.commit()


def approve_batch(
    session: Session, actor: User, batch_id: int
) -> ReimbursementBatchRead:
    batch = _draft_batch_or_409(session, batch_id)
    batch.state = PayrollRunState.approved
    batch.approved_by_id = actor.id
    batch.approved_at = utcnow()
    session.add(batch)
    session.commit()
    session.refresh(batch)
    return _read_batch(session, batch)


def mark_batch_paid(
    session: Session, actor: User, batch_id: int
) -> ReimbursementBatchRead:
    """Say the money went out; every claim in it is paid back as of now."""
    batch = _batch_or_404(session, batch_id)
    if batch.state is not PayrollRunState.approved:
        raise api_error(
            status_code=409,
            code=ErrorCode.reimbursement_batch_not_approved,
            detail="Only an approved batch can be marked paid",
        )
    batch.state = PayrollRunState.paid
    batch.paid_by_id = actor.id
    batch.paid_at = utcnow()
    session.add(batch)
    session.exec(
        update(Expense)
        .where(Expense.reimbursement_batch_id == batch.id)
        .values(reimbursed_at=batch.paid_at)
    )
    session.commit()
    session.refresh(batch)
    return _read_batch(session, batch)


def batch_export_rows(
    session: Session, batch_id: int
) -> tuple[ReimbursementBatch, Iterator[list[str]]]:
    """The approved batch as the payroll CSV's rows: one per person per
    currency, over the days the claims were spent. Approved or paid only."""
    batch = _batch_or_404(session, batch_id)
    if batch.state is PayrollRunState.draft:
        raise api_error(
            status_code=409,
            code=ErrorCode.reimbursement_batch_not_approved,
            detail="Approve the batch before exporting it",
        )
    claims = _batch_claims(session, batch.id)
    spans: dict[tuple[int, str], list[date]] = defaultdict(list)
    for claim in claims:
        spans[(claim.submitter_id, claim.currency)].append(claim.incurred_on)
    by_person = {claim.submitter_id: claim.submitter for claim in claims}

    def rows() -> Iterator[list[str]]:
        yield CSV_COLUMNS
        for line in _lines(claims):
            days = spans[(line.person.id, line.currency.value)]
            yield [
                by_person[line.person.id].full_name,
                decimal(line.amount_minor, line.currency.value),
                line.currency.value,
                min(days).isoformat(),
                max(days).isoformat(),
                "reimbursement",
            ]

    return batch, rows()


# --- On a payroll run, and back off ------------------------------------------------


def carry(session: Session, run_id: int, expense_ids: list[int]) -> PayrollRunRead:
    """Pay approved claims back with a draft run's pay.

    Only for people the run pays: somebody on another schedule, or with no
    pay recorded, has no wage line for a reimbursement to sit beside.
    """
    run = payroll._draft_or_409(session, run_id)
    claims = _settleable(session, expense_ids)
    paid_on_run = {
        line.person.id
        for line in payroll._draft_lines(session, run)
        if not line.missing
    }
    off = sorted(
        {
            claim.submitter.full_name
            for claim in claims
            if claim.submitter_id not in paid_on_run
        }
    )
    if off:
        raise api_error(
            status_code=409,
            code=ErrorCode.reimbursement_not_on_run,
            detail=f"This run does not pay {', '.join(off)}: carry their claims on "
            "the run for their own pay schedule, or in a batch",
        )
    for claim in claims:
        claim.payroll_run_id = run.id
        session.add(claim)
    session.commit()
    return payroll.get_run(session, run.id)


def release(session: Session, expense_id: int) -> ClaimRead:
    """Take a claim back out of a draft batch or off a draft run, back to
    awaiting. An emptied draft batch goes with it."""
    expense = session.get(Expense, expense_id)
    if expense is None:
        raise api_error(
            status_code=404,
            code=ErrorCode.expense_not_found,
            detail="Expense claim not found",
        )
    container = expense.reimbursement_batch or expense.payroll_run
    if container is not None and container.state is not PayrollRunState.draft:
        raise api_error(
            status_code=409,
            code=ErrorCode.expense_settlement_locked,
            detail=f"“{expense.description}” is {_where(expense)} that has been "
            "approved, and stays there",
        )
    batch = expense.reimbursement_batch
    expense.reimbursement_batch_id = None
    expense.payroll_run_id = None
    session.add(expense)
    session.flush()
    if batch is not None:
        left = session.exec(
            select(func.count())
            .select_from(Expense)
            .where(Expense.reimbursement_batch_id == batch.id)
        ).one()
        if left == 0:
            session.delete(batch)
    session.commit()
    return claim_read(
        session.exec(_claims_query().where(Expense.id == expense_id)).one()
    )
