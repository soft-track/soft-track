import { keepPreviousData, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { type FormEvent, useId, useState } from 'react'

import { errorDetail } from '@/api/errors'
import {
  useCreateBudgetFinanceBudgetsPost,
  useDeleteBudgetFinanceBudgetsBudgetIdDelete,
  useGetActualBreakdownFinanceBudgetsActualsGet,
  useGetBudgetOverviewFinanceBudgetsGet,
  useUpdateBudgetFinanceBudgetsBudgetIdPatch,
} from '@/api/generated/endpoints/budgets/budgets'
import { useListDepartmentsDepartmentsGet } from '@/api/generated/endpoints/departments/departments'
import type { BudgetRow, Currency } from '@/api/generated/models'
import {
  type Granularity,
  type Period,
  periodLabel,
  periodOf,
  periodShortLabel,
  periodsAround,
} from '@/finance/budgetPeriods'
import { currencySymbol, fromMinorUnits, toMinorUnits } from '@/finance/money'
import { runTitle } from '@/finance/payrollPeriod'
import { isFinanceQuery } from '@/finance/queries'
import { useCurrencies } from '@/finance/useCurrencies'
import { useTranslation } from '@/i18n'
import { formatNumber } from '@/i18n/format'
import { DepartmentDot } from '@/people/DepartmentChip'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

const GRANULARITIES: (Granularity | 'custom')[] = ['month', 'quarter', 'year', 'custom']

/**
 * Finance → Budgets (#134): what each department meant to spend in a period,
 * beside what it actually did -- per currency, over budget in red, and
 * Unattributed as a row of its own.
 *
 * The budget shown is the one set for exactly the period chosen. A quarterly
 * budget is not spread over its months: that would be a forecast, and the
 * point of the page is that nothing on it is guessed.
 */
export default function BudgetsPage() {
  const { t } = useTranslation(['finance', 'common'])
  const [granularity, setGranularity] = useState<Granularity | 'custom'>('quarter')
  const [period, setPeriod] = useState<Period>(() => periodOf('quarter', new Date()))
  const [editing, setEditing] = useState<BudgetRow | 'new' | null>(null)
  const [showing, setShowing] = useState<BudgetRow | null>(null)
  const overview = useGetBudgetOverviewFinanceBudgetsGet(
    { start: period.start, end: period.end },
    { query: { placeholderData: keepPreviousData } },
  )
  const rows = overview.data?.rows ?? []
  const options = granularity === 'custom' ? [] : periodsAround(granularity)

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
              {t('budgets.title')}
            </h1>
            <p className="mt-1 max-w-prose text-sm text-neutral-500">{t('budgets.intro')}</p>
          </div>
          <button type="button" onClick={() => setEditing('new')} className="btn btn-primary">
            <Icon name="plus" size={15} />
            {t('budgets.newBudget')}
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {granularity === 'custom' ? (
            <>
              <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                {t('budgets.from')}
                <input
                  type="date"
                  value={period.start}
                  max={period.end}
                  onChange={(e) =>
                    e.target.value && setPeriod({ ...period, start: e.target.value })
                  }
                  className="field field-sm w-auto"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-neutral-500">
                {t('budgets.to')}
                <input
                  type="date"
                  value={period.end}
                  min={period.start}
                  onChange={(e) => e.target.value && setPeriod({ ...period, end: e.target.value })}
                  className="field field-sm w-auto"
                />
              </label>
            </>
          ) : (
            <Select
              dense
              aria-label={t('budgets.periodLabel')}
              value={`${period.start}/${period.end}`}
              onChange={(e) => {
                const [start, end] = e.target.value.split('/')
                setPeriod({ start, end })
              }}
            >
              {options.map((option) => (
                <option key={option.start} value={`${option.start}/${option.end}`}>
                  {periodLabel(option)}
                </option>
              ))}
            </Select>
          )}
          <div className="segmented" role="group" aria-label={t('budgets.granularity.label')}>
            {GRANULARITIES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={granularity === option}
                data-active={granularity === option}
                onClick={() => {
                  setGranularity(option)
                  // Keep the day in view: this quarter, this quarter's month.
                  if (option !== 'custom') setPeriod(periodOf(option, new Date(period.start)))
                }}
                className="segmented-item"
              >
                {t(`budgets.granularity.${option}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="glass-strong rounded-panel p-4 sm:p-6">
        {overview.isPending ? (
          <Loading label={t('budgets.loading')} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('budgets.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <BudgetTable rows={rows} onEdit={setEditing} onShow={setShowing} />
          </div>
        )}
      </section>

      {editing && (
        <BudgetDialog
          row={editing === 'new' ? null : editing}
          period={period}
          onClose={() => setEditing(null)}
        />
      )}
      {showing && <SourcesDialog row={showing} period={period} onClose={() => setShowing(null)} />}
    </div>
  )
}

function BudgetTable({
  rows,
  onEdit,
  onShow,
}: {
  rows: BudgetRow[]
  onEdit: (row: BudgetRow) => void
  onShow: (row: BudgetRow) => void
}) {
  const { t } = useTranslation(['finance', 'common'])
  const { format } = useCurrencies()
  const cell = 'hairline border-t px-3 py-2.5'
  return (
    <table className="w-full border-separate border-spacing-0 text-left text-sm">
      <thead>
        <tr className="eyebrow">
          <th scope="col" className="px-3 py-2 font-semibold">
            {t('budgets.columns.department')}
          </th>
          <th scope="col" className="px-3 py-2 font-semibold">
            <span className="sr-only">{t('budgets.columns.currency')}</span>
          </th>
          <th scope="col" className="px-3 py-2 text-right font-semibold">
            {t('budgets.columns.budget')}
          </th>
          <th scope="col" className="px-3 py-2 text-right font-semibold">
            {t('budgets.columns.actual')}
          </th>
          <th scope="col" className="px-3 py-2 font-semibold">
            <span className="sr-only">{t('budgets.columns.progress')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const name = row.department?.name ?? t('budgets.unattributed')
          // The name once per department: its other currencies follow it.
          const first = index === 0 || rows[index - 1].department?.id !== row.department?.id
          const budget = row.budget?.amount_minor ?? null
          const share = budget ? row.actual_minor / budget : null
          const over = share !== null && share > 1
          return (
            <tr
              key={`${row.department?.id ?? 'none'}-${row.currency}`}
              className={clsx(over && 'bg-danger-50/70', !row.department && 'bg-accent-amber/5')}
            >
              <td className={cell}>
                <span className="flex items-center gap-2">
                  {row.department ? (
                    <DepartmentDot id={row.department.id} />
                  ) : (
                    <Icon name="flag" size={12} className="text-accent-amber" />
                  )}
                  {first && (
                    <span
                      className="font-medium text-neutral-900"
                      title={row.department ? undefined : t('budgets.unattributedHint')}
                    >
                      {name}
                    </span>
                  )}
                </span>
              </td>
              <td className={cell}>
                <span className="identifier rounded bg-neutral-900/6 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-500">
                  {row.currency}
                </span>
              </td>
              <td className={`${cell} text-right`}>
                {row.budget ? (
                  <button
                    type="button"
                    onClick={() => onEdit(row)}
                    aria-label={t('budgets.editBudget', {
                      currency: row.currency,
                      department: name,
                    })}
                    className="identifier tabular-nums text-neutral-700 hover:underline"
                  >
                    {format(row.budget.amount_minor, row.currency)}
                  </button>
                ) : (
                  <span className="text-neutral-400">–</span>
                )}
              </td>
              <td className={`${cell} text-right`}>
                <button
                  type="button"
                  onClick={() => onShow(row)}
                  aria-label={t('budgets.showSources', {
                    department: name,
                    currency: row.currency,
                  })}
                  className="identifier font-medium tabular-nums text-neutral-900 hover:underline"
                >
                  {format(row.actual_minor, row.currency)}
                </button>
              </td>
              <td className={`${cell} min-w-56`}>
                {budget === null ? (
                  <span className="block text-right text-xs text-neutral-400">
                    {t('budgets.noBudget')}
                  </span>
                ) : (
                  <span className="flex items-center gap-3">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-900/8">
                      <span
                        className={clsx(
                          'block h-full rounded-full',
                          over ? 'bg-danger-500' : 'bg-brand-500',
                        )}
                        style={{ width: `${Math.min(1, share ?? 0) * 100}%` }}
                      />
                    </span>
                    <span
                      className={clsx(
                        'shrink-0 text-right text-xs',
                        over ? 'font-semibold text-danger-600' : 'text-neutral-500',
                      )}
                    >
                      {t(over ? 'budgets.over' : 'budgets.left', {
                        percent: formatNumber(share ?? 0, {
                          style: 'percent',
                          maximumFractionDigits: 0,
                        }),
                        amount: format(Math.abs(budget - row.actual_minor), row.currency),
                      })}
                    </span>
                  </span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** A new budget, or the one on a row being changed. */
function BudgetDialog({
  row,
  period,
  onClose,
}: {
  row: BudgetRow | null
  period: Period
  onClose: () => void
}) {
  const { t } = useTranslation(['finance', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const queryClient = useQueryClient()
  const { currencies, placesOf } = useCurrencies()
  const departments = useListDepartmentsDepartmentsGet()
  const create = useCreateBudgetFinanceBudgetsPost()
  const update = useUpdateBudgetFinanceBudgetsBudgetIdPatch()
  const remove = useDeleteBudgetFinanceBudgetsBudgetIdDelete()
  const existing = row?.budget ?? null
  const [departmentId, setDepartmentId] = useState(String(row?.department?.id ?? ''))
  const [start, setStart] = useState(existing?.period_start ?? period.start)
  const [end, setEnd] = useState(existing?.period_end ?? period.end)
  const [currency, setCurrency] = useState<Currency>(row?.currency ?? 'EUR')
  const places = placesOf(currency)
  const [amount, setAmount] = useState(
    existing ? fromMinorUnits(existing.amount_minor, places) : '',
  )
  const [error, setError] = useState<string | null>(null)
  const minor = amount.trim() ? toMinorUnits(amount, places) : null
  const busy = create.isPending || update.isPending || remove.isPending
  const canSubmit = minor !== null && minor > 0 && departmentId !== '' && start <= end && !busy

  const done = async (request: Promise<unknown>) => {
    setError(null)
    try {
      await request
      await queryClient.invalidateQueries({ predicate: isFinanceQuery })
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('budgets.dialog.error')))
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit || minor === null) return
    void done(
      existing
        ? update.mutateAsync({
            budgetId: existing.id,
            data: { amount_minor: minor, period_start: start, period_end: end },
          })
        : create.mutateAsync({
            data: {
              department_id: Number(departmentId),
              period_start: start,
              period_end: end,
              amount_minor: minor,
              currency,
            },
          }),
    )
  }

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
        className="pop-in glass-strong w-full max-w-md rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {existing && row?.department
            ? t('budgets.dialog.editTitle', { department: row.department.name })
            : t('budgets.dialog.newTitle')}
        </h2>

        {!existing && (
          <label className="mt-4 block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              {t('budgets.dialog.department')}
            </span>
            <Select
              block
              required
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">{t('budgets.dialog.chooseDepartment')}</option>
              {(departments.data ?? []).map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </label>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              {t('budgets.dialog.starts')}
            </span>
            <input
              type="date"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="field"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              {t('budgets.dialog.ends')}
            </span>
            <input
              type="date"
              required
              min={start}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="field"
            />
          </label>
        </div>
        <p className="mt-1 text-xs text-neutral-400">{t('budgets.dialog.periodHint')}</p>

        <div className="mt-3 grid grid-cols-[1fr_auto] gap-3">
          <div>
            <label
              htmlFor={`${titleId}-amount`}
              className="mb-1 block text-xs font-medium text-neutral-500"
            >
              {t('budgets.dialog.amount')}
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
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={amount.trim() && minor === null ? true : undefined}
                className="field pl-8 tabular-nums"
              />
            </span>
            {amount.trim() && minor === null && (
              <span className="mt-1 block text-xs text-danger-600">
                {t('budgets.dialog.invalid', { count: places })}
              </span>
            )}
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              {t('budgets.dialog.currency')}
            </span>
            <Select
              value={currency}
              disabled={Boolean(existing)}
              onChange={(e) => setCurrency(e.target.value as Currency)}
            >
              {(currencies.length > 0 ? currencies.map((c) => c.code) : [currency]).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </label>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger-600">
            {error}
          </p>
        )}

        <div className="hairline mt-5 flex items-center justify-between gap-2 border-t pt-4">
          {existing ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t('budgets.dialog.confirmRemove'))) {
                  void done(remove.mutateAsync({ budgetId: existing.id }))
                }
              }}
              className="btn btn-danger-ghost btn-sm"
            >
              {t('budgets.dialog.remove')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost">
              {t('common:cancel')}
            </button>
            <button type="submit" disabled={!canSubmit} className="btn btn-primary">
              {busy
                ? t('budgets.dialog.saving')
                : existing
                  ? t('budgets.dialog.save')
                  : t('budgets.dialog.create')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

/** Where one actual comes from: the runs and batches it sums. */
function SourcesDialog({
  row,
  period,
  onClose,
}: {
  row: BudgetRow
  period: Period
  onClose: () => void
}) {
  const { t } = useTranslation(['finance', 'common'])
  const dialogRef = useFocusTrap<HTMLDivElement>()
  const titleId = useId()
  const { format } = useCurrencies()
  const breakdown = useGetActualBreakdownFinanceBudgetsActualsGet({
    start: period.start,
    end: period.end,
    currency: row.currency,
    department_id: row.department?.id,
  })
  const name = row.department?.name ?? t('budgets.unattributed')

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        className="pop-in glass-strong w-full max-w-lg rounded-panel p-5"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
            {t('budgets.sources.title', { department: name, period: periodShortLabel(period) })}
          </h2>
          <p className="identifier text-lg font-semibold tabular-nums text-neutral-900">
            {format(row.actual_minor, row.currency)}
          </p>
        </div>
        {!breakdown.data ? (
          <Loading label={t('budgets.sources.loading')} />
        ) : breakdown.data.sources.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">{t('budgets.sources.none')}</p>
        ) : (
          <table className="mt-4 w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="eyebrow">
                <th scope="col" className="px-2 py-2 font-semibold">
                  {t('budgets.sources.columns.source')}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">
                  {t('budgets.sources.columns.rows')}
                </th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">
                  {t('budgets.sources.columns.amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {breakdown.data.sources.map((source) => {
                const run =
                  source.period_start && source.period_end
                    ? runTitle({ period_start: source.period_start, period_end: source.period_end })
                    : ''
                return (
                  <tr key={`${source.kind}-${source.id}`}>
                    <td className="hairline border-t px-2 py-2 text-neutral-700">
                      {source.kind === 'payroll_run'
                        ? t('budgets.sources.payrollRun', { run })
                        : source.kind === 'reimbursement_batch'
                          ? t('budgets.sources.batch', { batch: `RB-${source.id}` })
                          : t('budgets.sources.onRun', { run })}
                    </td>
                    <td className="hairline border-t px-2 py-2 text-right tabular-nums text-neutral-600">
                      {source.rows}
                    </td>
                    <td className="hairline identifier border-t px-2 py-2 text-right tabular-nums text-neutral-900">
                      {format(source.amount_minor, row.currency)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <p className="well mt-4 flex items-start gap-2 rounded-card px-3 py-2.5 text-xs text-neutral-600">
          <Icon name="history" size={13} className="mt-0.5 shrink-0" />
          {t('budgets.sources.attribution')}
        </p>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:close')}
          </button>
        </div>
      </div>
    </div>
  )
}
