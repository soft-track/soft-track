import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'

import {
  useGetCompensationHistoryFinanceCompensationUsernameGet,
  useRecordCompensationFinanceCompensationUsernamePost,
} from '@/api/generated/endpoints/compensation/compensation'
import { useListPeopleUsersGet } from '@/api/generated/endpoints/people/people'
import {
  CompensationKind,
  type CompensationRecordRead,
  type Currency,
  PaySchedule,
} from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { currencySymbol, formatDay, fromMinorUnits, toMinorUnits } from '@/finance/money'
import { isFinanceQuery } from '@/finance/queries'
import { useCurrencies } from '@/finance/useCurrencies'
import { useTranslation } from '@/i18n'
import { type PersonOption, PersonPicker } from '@/people/PersonPicker'
import { useDebounced } from '@/search/useDebounced'
import { localToday } from '@/tickets/dueDate'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

const KINDS = [
  CompensationKind.raise,
  CompensationKind.hire,
  CompensationKind.correction,
  CompensationKind.other,
] as const

/**
 * Recording a decision about somebody's pay (#131).
 *
 * There is no edit: a raise is a new record, and so is a correction, which
 * names the record it replaces and starts from its figures. Opened for one
 * person from their history, or for anybody from the list, where it asks
 * whose pay first.
 */
export function RecordPayDialog({
  person: fixed,
  onClose,
}: {
  person?: PersonOption | null
  onClose: () => void
}) {
  const { t } = useTranslation(['finance', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const queryClient = useQueryClient()
  const { currencies, placesOf, format } = useCurrencies()
  const recordPay = useRecordCompensationFinanceCompensationUsernamePost()

  const [chosen, setChosen] = useState<PersonOption | null>(null)
  const [search, setSearch] = useState('')
  const query = useDebounced(search, 200)
  const candidates = useListPeopleUsersGet({ q: query || undefined, limit: 8 })
  const person = fixed ?? chosen

  const history = useGetCompensationHistoryFinanceCompensationUsernameGet(person?.username ?? '', {
    query: { enabled: Boolean(person) },
  })
  const records = history.data?.records ?? []
  const correctable = records.filter((record) => record.standing !== 'corrected')
  const current = records.find((record) => record.standing === 'current') ?? correctable[0]

  // The form starts from what they are paid now, once that is known -- and
  // a choice somebody has already made is theirs, not the history's.
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [form, setForm] = useState({
    amount: '',
    currency: 'USD' as Currency,
    schedule: PaySchedule.monthly as PaySchedule,
    effectiveOn: localToday(),
    kind: null as CompensationKind | null,
    correctsId: null as number | null,
    note: '',
  })
  const set = (changes: Partial<typeof form>) => {
    setForm((previous) => ({ ...previous, ...changes }))
    setTouched((previous) => ({
      ...previous,
      ...Object.fromEntries(Object.keys(changes).map((key) => [key, true])),
    }))
  }
  const currency = touched.currency || !current ? form.currency : current.currency
  const schedule = touched.schedule || !current ? form.schedule : current.pay_schedule
  const kind =
    form.kind ??
    (history.isSuccess && records.length === 0 ? CompensationKind.hire : CompensationKind.raise)
  const places = placesOf(currency)
  const minor = form.amount ? toMinorUnits(form.amount, places) : null
  const [error, setError] = useState<string | null>(null)

  /** A correction starts from the figures of the record it corrects. */
  const correct = (record: CompensationRecordRead | undefined) => {
    set({
      correctsId: record?.id ?? null,
      ...(record && {
        amount: fromMinorUnits(record.amount_minor, placesOf(record.currency)),
        currency: record.currency,
        schedule: record.pay_schedule,
        effectiveOn: record.effective_on,
      }),
    })
  }

  const chooseKind = (next: CompensationKind) => {
    set({ kind: next })
    if (next === CompensationKind.correction && form.correctsId === null) correct(current)
    if (next !== CompensationKind.correction) set({ kind: next, correctsId: null })
  }

  const canSubmit =
    person !== null &&
    minor !== null &&
    minor > 0 &&
    (kind !== CompensationKind.correction || form.correctsId !== null) &&
    !recordPay.isPending

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit || !person || minor === null) return
    setError(null)
    try {
      await recordPay.mutateAsync({
        username: person.username,
        data: {
          amount_minor: minor,
          currency,
          pay_schedule: schedule,
          effective_on: form.effectiveOn,
          kind,
          note: form.note.trim() || null,
          corrects_id: kind === CompensationKind.correction ? form.correctsId : null,
        },
      })
      await queryClient.invalidateQueries({ predicate: isFinanceQuery })
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('compensation.record.error')))
    }
  }

  const amountProblem =
    form.amount && minor === null
      ? places === 0
        ? t('compensation.record.wholeOnly', { currency })
        : t('compensation.record.tooPrecise', { count: places })
      : null

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center overflow-y-auto px-4 py-[10vh]"
      onClick={onClose}
    >
      <form
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        className="pop-in glass-strong w-full max-w-lg rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {fixed
            ? t('compensation.record.title', { name: fixed.full_name })
            : t('compensation.record.titleSomebody')}
        </h2>

        {!fixed && (
          <div className="mt-4">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              {t('compensation.record.person')}
            </span>
            <PersonPicker
              label={t('compensation.record.personLabel')}
              value={chosen}
              results={(candidates.data?.items ?? []).filter((candidate) => candidate.is_active)}
              onSearch={setSearch}
              onChange={(next) => {
                setChosen(next)
                setTouched({})
              }}
              noneLabel={t('compensation.record.nobody')}
              placeholder={t('compensation.record.searchPeople')}
              noneOption={false}
            />
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            {/* The label holds only its words: the currency symbol and the
                note below sit beside the field, not inside its name. */}
            <label
              htmlFor={`${titleId}-amount`}
              className="mb-1 block text-xs font-medium text-neutral-500"
            >
              {t('compensation.record.amount')}
            </label>
            <span className="relative block">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400"
              >
                {currencySymbol(currency)}
              </span>
              <input
                id={`${titleId}-amount`}
                inputMode="decimal"
                autoComplete="off"
                required
                value={form.amount}
                onChange={(e) => set({ amount: e.target.value })}
                aria-invalid={amountProblem ? true : undefined}
                aria-describedby={`${titleId}-amount-note`}
                className="field pl-8 tabular-nums"
              />
            </span>
            <span id={`${titleId}-amount-note`} className="mt-1 block text-xs text-neutral-400">
              {amountProblem ? (
                <span className="text-danger-600">{amountProblem}</span>
              ) : (
                minor !== null && t('compensation.record.stored', { minor: String(minor) })
              )}
            </span>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              {t('compensation.record.currency')}
            </span>
            <Select
              block
              value={currency}
              onChange={(e) => set({ currency: e.target.value as Currency })}
            >
              {(currencies.length > 0 ? currencies.map((c) => c.code) : [currency]).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              {t('compensation.record.schedule')}
            </span>
            <Select
              block
              value={schedule}
              onChange={(e) => set({ schedule: e.target.value as PaySchedule })}
            >
              {Object.values(PaySchedule).map((option) => (
                <option key={option} value={option}>
                  {t(`compensation.schedules.${option}`)}
                </option>
              ))}
            </Select>
          </label>
          <div>
            <label
              htmlFor={`${titleId}-effective`}
              className="mb-1 block text-xs font-medium text-neutral-500"
            >
              {t('compensation.record.effective')}
            </label>
            <input
              id={`${titleId}-effective`}
              type="date"
              required
              value={form.effectiveOn}
              onChange={(e) => set({ effectiveOn: e.target.value })}
              className="field"
            />
            {form.effectiveOn > localToday() && (
              <span className="mt-1 block text-xs text-neutral-400">
                {t('compensation.record.future')}
              </span>
            )}
          </div>
        </div>

        <div className="mt-4">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            {t('compensation.record.kind')}
          </span>
          <div className="segmented" role="group" aria-label={t('compensation.record.kind')}>
            {KINDS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={kind === option}
                data-active={kind === option}
                onClick={() => chooseKind(option)}
                className="segmented-item"
              >
                {t(`compensation.kinds.${option}`)}
              </button>
            ))}
          </div>
        </div>

        {kind === CompensationKind.correction && (
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              {t('compensation.record.corrects')}
            </span>
            {correctable.length === 0 ? (
              <span className="block text-xs text-neutral-400">
                {t('compensation.record.nothingToCorrect')}
              </span>
            ) : (
              <Select
                block
                value={form.correctsId ?? ''}
                onChange={(e) =>
                  correct(correctable.find((record) => record.id === Number(e.target.value)))
                }
              >
                {correctable.map((record) => (
                  <option key={record.id} value={record.id}>
                    {t('compensation.record.correctsOption', {
                      amount: format(record.amount_minor, record.currency),
                      date: formatDay(record.effective_on),
                    })}
                  </option>
                ))}
              </Select>
            )}
          </label>
        )}

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            {t('compensation.record.note')}{' '}
            <span className="font-normal text-neutral-400">
              · {t('compensation.record.optional')}
            </span>
          </span>
          <input
            value={form.note}
            onChange={(e) => set({ note: e.target.value })}
            maxLength={500}
            placeholder={t('compensation.record.notePlaceholder')}
            className="field"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger-600">
            {error}
          </p>
        )}

        <div className="hairline mt-5 flex justify-end gap-2 border-t pt-4">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:cancel')}
          </button>
          <button type="submit" disabled={!canSubmit} className="btn btn-primary">
            {recordPay.isPending
              ? t('compensation.record.submitting')
              : t('compensation.record.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
