"""Compensation (#131): what people are paid, as an effective-dated history.

Every record is a decision -- hired at this, raised to that from March -- and
records are only ever added. Which one is somebody's pay on a given day is
worked out, never stored:

- a record some correction names is out, as if it had never been recorded:
  the correction says it was wrong;
- of the rest, the one with the latest effective date on or before the day is
  the pay, and on a tie the one recorded last.

That is what makes "what was Daniel paid in Q1" have one answer however many
raises and corrections were recorded since, and it is the question payroll
runs (#132) ask of every person on every run.

Gross agreed pay is the whole record. No deductions, no withholding, no bonus
or equity: what leaves the gross before it reaches a bank account is the
payroll bureau's business, and mostly not SoftTrack's at all.
"""

from datetime import date
from typing import Iterable, Optional

from sqlalchemy import case
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, func, or_, select

from lib_finance.models.compensation import (
    CompensationCreate,
    CompensationHistory,
    CompensationPage,
    CompensationRecordRead,
    CompensationRow,
    CompensationStanding,
    CompensationTotal,
)
from lib_finance.models.money import FinancePerson
from lib_finance.money import Currency
from lib_identity.models.identity import PersonRef
from lib_identity.people import find_by_username
from lib_softtrack.models.page import DEFAULT_LIMIT
from lib_softtrack.tables import Compensation, PaySchedule, User
from lib_utils.errors import ErrorCode, api_error

#: Totals are listed monthly first, the way pay is usually talked about.
_SCHEDULE_ORDER = list(PaySchedule)


def _corrected_ids():
    return select(Compensation.corrects_id).where(
        col(Compensation.corrects_id).is_not(None)
    )


def in_effect(day: date):
    """The ids of the records in effect on `day`, at most one per person.

    Ranked in the database -- the latest effective date first, then the
    latest recorded -- so a list of everybody's pay is one query, not one per
    person.
    """
    ranked = (
        select(
            Compensation.id,
            func.row_number()
            .over(
                partition_by=Compensation.user_id,
                order_by=(
                    col(Compensation.effective_on).desc(),
                    col(Compensation.id).desc(),
                ),
            )
            .label("rank"),
        )
        .where(
            Compensation.effective_on <= day,
            col(Compensation.id).not_in(_corrected_ids()),
        )
        .subquery()
    )
    return select(ranked.c.id).where(ranked.c.rank == 1)


def pay_on(
    session: Session, user_ids: Iterable[int], day: date
) -> dict[int, Compensation]:
    """What each of these people is paid on `day`, by user id. Somebody with
    nothing in effect on that day is absent from the result."""
    ids = list(user_ids)
    rows = session.exec(
        select(Compensation).where(
            col(Compensation.id).in_(in_effect(day)),
            col(Compensation.user_id).in_(ids or [0]),
        )
    ).all()
    return {row.user_id: row for row in rows}


def _read(
    record: Compensation, standing: CompensationStanding, corrected_by: dict[int, int]
) -> CompensationRecordRead:
    return CompensationRecordRead(
        id=record.id,
        amount_minor=record.amount_minor,
        currency=record.currency,
        pay_schedule=record.pay_schedule,
        effective_on=record.effective_on,
        kind=record.kind,
        note=record.note,
        corrects_id=record.corrects_id,
        corrected_by_id=corrected_by.get(record.id),
        standing=standing,
        recorded_by=PersonRef.model_validate(record.recorded_by),
        created_at=record.created_at,
    )


class _Chain:
    """One person's records, read on one day."""

    def __init__(self, records: list[Compensation], day: date):
        self.day = day
        self.corrected_by = {r.corrects_id: r.id for r in records if r.corrects_id}
        # Latest effective date first; the later recorded first on a tie.
        self.records = sorted(
            records, key=lambda r: (r.effective_on, r.id), reverse=True
        )
        live = [r for r in self.records if r.id not in self.corrected_by]
        started = [r for r in live if r.effective_on <= day]
        self.current = started[0] if started else None
        self.previous = started[1] if len(started) > 1 else None
        # Soonest first.
        self.scheduled = [r for r in reversed(live) if r.effective_on > day]

    def standing(self, record: Compensation) -> CompensationStanding:
        if record.id in self.corrected_by:
            return CompensationStanding.corrected
        if self.current is not None and record.id == self.current.id:
            return CompensationStanding.current
        if record.effective_on > self.day:
            return CompensationStanding.scheduled
        return CompensationStanding.past

    def read(self, record: Compensation) -> CompensationRecordRead:
        return _read(record, self.standing(record), self.corrected_by)

    def change_percent(self) -> Optional[float]:
        current, previous = self.current, self.previous
        if (
            current is None
            or previous is None
            or current.currency != previous.currency
            or current.pay_schedule != previous.pay_schedule
        ):
            return None
        change = (current.amount_minor - previous.amount_minor) / previous.amount_minor
        return round(change * 100, 1)


def _chains(session: Session, user_ids: list[int], day: date) -> dict[int, _Chain]:
    records = session.exec(
        select(Compensation)
        .where(col(Compensation.user_id).in_(user_ids or [0]))
        .options(selectinload(Compensation.recorded_by))
    ).all()
    by_user: dict[int, list[Compensation]] = {user_id: [] for user_id in user_ids}
    for record in records:
        by_user[record.user_id].append(record)
    return {user_id: _Chain(rows, day) for user_id, rows in by_user.items()}


def list_compensation(
    session: Session,
    day: date,
    q: Optional[str] = None,
    department_id: Optional[int] = None,
    currency: Optional[Currency] = None,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> CompensationPage:
    """Everybody active, with what they are paid on `day`.

    People with nothing in effect come last and are counted in `missing`:
    the ones a payroll run would otherwise quietly leave out.
    """
    effective = in_effect(day)
    filters = [User.is_active == True]  # noqa: E712 -- SQL comparison
    if q and q.strip():
        needle = f"%{q.strip()}%"
        filters.append(
            or_(col(User.full_name).ilike(needle), col(User.username).ilike(needle))
        )
    if department_id is not None:
        filters.append(User.department_id == department_id)
    if currency is not None:
        filters.append(
            col(User.id).in_(
                select(Compensation.user_id).where(
                    col(Compensation.id).in_(effective),
                    Compensation.currency == currency.value,
                )
            )
        )
    paid = col(User.id).in_(
        select(Compensation.user_id).where(col(Compensation.id).in_(effective))
    )

    total = session.exec(select(func.count()).select_from(User).where(*filters)).one()
    missing = session.exec(
        select(func.count()).select_from(User).where(*filters, ~paid)
    ).one()
    people = session.exec(
        select(User)
        .where(*filters)
        .options(selectinload(User.department))
        .order_by(case((paid, 0), else_=1), func.lower(User.full_name), User.id)
        .limit(limit)
        .offset(offset)
    ).all()

    chains = _chains(session, [person.id for person in people], day)
    items = []
    for person in people:
        chain = chains[person.id]
        items.append(
            CompensationRow(
                person=FinancePerson.model_validate(person),
                current=chain.read(chain.current) if chain.current else None,
                change_percent=chain.change_percent(),
                scheduled=[chain.read(record) for record in chain.scheduled],
            )
        )

    sums = session.exec(
        select(
            Compensation.currency,
            Compensation.pay_schedule,
            func.sum(Compensation.amount_minor),
            func.count(),
        )
        .where(
            col(Compensation.id).in_(effective),
            col(Compensation.user_id).in_(select(User.id).where(*filters)),
        )
        .group_by(Compensation.currency, Compensation.pay_schedule)
    ).all()
    totals = sorted(
        (
            CompensationTotal(
                currency=currency_code,
                pay_schedule=schedule,
                amount_minor=amount,
                people=count,
            )
            for currency_code, schedule, amount, count in sums
        ),
        key=lambda t: (_SCHEDULE_ORDER.index(t.pay_schedule), t.currency.value),
    )

    return CompensationPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        totals=totals,
        missing=missing,
    )


def _person_or_404(session: Session, username: str) -> User:
    person = find_by_username(session, username)
    if person is None:
        raise api_error(
            status_code=404, code=ErrorCode.user_not_found, detail="User not found"
        )
    return person


def history(session: Session, username: str, day: date) -> CompensationHistory:
    """Every record somebody has, with where each one stands on `day`.

    Resolves for a deactivated account too: somebody who has left still has
    the history of what they were paid.
    """
    person = _person_or_404(session, username)
    chain = _chains(session, [person.id], day)[person.id]
    return CompensationHistory(
        person=FinancePerson.model_validate(person),
        records=[chain.read(record) for record in chain.records],
    )


def record(
    session: Session,
    actor: User,
    username: str,
    payload: CompensationCreate,
    day: date,
) -> CompensationRecordRead:
    """Add a record. The only write there is: nothing is edited or deleted."""
    person = _person_or_404(session, username)

    if payload.corrects_id is not None:
        target = session.get(Compensation, payload.corrects_id)
        if target is None or target.user_id != person.id:
            raise api_error(
                status_code=404,
                code=ErrorCode.compensation_not_found,
                detail="That compensation record does not exist",
            )
        _refuse_a_second_correction(session, target.id)

    row = Compensation(
        user_id=person.id,
        amount_minor=payload.amount_minor,
        currency=payload.currency.value,
        pay_schedule=payload.pay_schedule,
        effective_on=payload.effective_on,
        kind=payload.kind,
        note=(payload.note or "").strip() or None,
        corrects_id=payload.corrects_id,
        recorded_by_id=actor.id,
    )
    session.add(row)
    try:
        session.commit()
    except IntegrityError:
        # Two corrections of one record at once: the constraint is what
        # decides, and the loser is told the same as if it had come second.
        session.rollback()
        if payload.corrects_id is not None:
            _refuse_a_second_correction(session, payload.corrects_id)
        raise
    session.refresh(row)

    chain = _chains(session, [person.id], day)[person.id]
    return chain.read(next(r for r in chain.records if r.id == row.id))


def _refuse_a_second_correction(session: Session, record_id: int) -> None:
    corrected = session.exec(
        select(Compensation.id).where(Compensation.corrects_id == record_id)
    ).first()
    if corrected is not None:
        raise api_error(
            status_code=409,
            code=ErrorCode.compensation_already_corrected,
            detail="That record has already been corrected. Correct the correction instead",
        )
