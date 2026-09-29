import { keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { errorDetail } from '@/api/errors'
import {
  useCreatePayrollRunFinancePayrollRunsPost,
  useListPayrollRunsFinancePayrollRunsGet,
} from '@/api/generated/endpoints/payroll/payroll'
import { PaySchedule, type PayrollRunSummary } from '@/api/generated/models'
import { MoneyTotals } from '@/finance/MoneyTotals'
import { PayrollStateChip } from '@/finance/PayrollStateChip'
import { nextPeriod, runTitle } from '@/finance/payrollPeriod'
import { isFinanceQuery } from '@/finance/queries'
import { useTranslation } from '@/i18n'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

const PAGE_SIZE = 50

/**
 * Finance → Payroll runs (#132): one per period and pay schedule, the newest
 * first, each with its state -- set by a finance admin, never derived -- and
 * its totals per currency.
 */
export default function PayrollRunsPage() {
  const { t } = useTranslation(['finance', 'common'])
  const [offset, setOffset] = useState(0)
  const [creating, setCreating] = useState(false)
  const runs = useListPayrollRunsFinancePayrollRunsGet(
    { limit: PAGE_SIZE, offset },
    { query: { placeholderData: keepPreviousData } },
  )
  const items = runs.data?.items ?? []
  const total = runs.data?.total ?? 0

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
              {t('payroll.title')}
            </h1>
            <p className="mt-1 max-w-prose text-sm text-neutral-500">{t('payroll.intro')}</p>
          </div>
          <button type="button" onClick={() => setCreating(true)} className="btn btn-primary">
            <Icon name="plus" size={15} />
            {t('payroll.newRun')}
          </button>
        </div>
      </div>

      <section className="glass-strong rounded-panel p-4 sm:p-6">
        {runs.isPending ? (
          <Loading label={t('payroll.loading')} />
        ) : items.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('payroll.empty')}</p>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="eyebrow">
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t('payroll.columns.period')}
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  {t('payroll.columns.state')}
                </th>
                <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">
                  {t('payroll.columns.totals')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </tbody>
          </table>
        )}

        {total > PAGE_SIZE && (
          <div className="hairline mt-4 flex items-center justify-between border-t pt-4">
            <p className="text-xs text-neutral-400">
              {t('payroll.showing', {
                from: offset + 1,
                to: Math.min(offset + PAGE_SIZE, total),
                total,
              })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="btn btn-ghost btn-sm"
              >
                <Icon name="chevron-left" size={14} />
                {t('payroll.previous')}
              </button>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="btn btn-ghost btn-sm"
              >
                {t('payroll.next')}
                <Icon name="chevron-right" size={14} />
              </button>
            </div>
          </div>
        )}
      </section>

      {creating && <NewRunDialog runs={items} onClose={() => setCreating(false)} />}
    </div>
  )
}

function RunRow({ run }: { run: PayrollRunSummary }) {
  const { t } = useTranslation(['finance', 'common'])
  const cell = 'hairline border-t px-3 py-3 align-top'
  return (
    <tr>
      <td className={cell}>
        <Link
          to={`/settings/finance/payroll/${run.id}`}
          className="font-medium text-neutral-900 hover:underline"
        >
          {runTitle(run)}
        </Link>
        <p className="text-xs text-neutral-400">
          {t(`compensation.schedules.${run.pay_schedule}`)}
        </p>
      </td>
      <td className={cell}>
        <div className="flex flex-wrap items-center gap-1.5">
          <PayrollStateChip state={run.state} />
          {run.missing_count > 0 && (
            <span className="text-xs text-danger-600">
              {t('payroll.missingCount', { count: run.missing_count })}
            </span>
          )}
        </div>
      </td>
      <td className={`${cell} hidden sm:table-cell`}>
        <MoneyTotals totals={run.totals} label={t('payroll.run.totalsLabel')} />
      </td>
    </tr>
  )
}

/** Generating a draft: a schedule, and the days it covers. */
function NewRunDialog({ runs, onClose }: { runs: PayrollRunSummary[]; onClose: () => void }) {
  const { t } = useTranslation(['finance', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const createRun = useCreatePayrollRunFinancePayrollRunsPost()

  const suggest = (schedule: PaySchedule) =>
    nextPeriod(
      schedule,
      runs.find((run) => run.pay_schedule === schedule),
    )
  const [schedule, setSchedule] = useState<PaySchedule>(PaySchedule.monthly)
  const [period, setPeriod] = useState(() => suggest(PaySchedule.monthly))
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      const run = await createRun.mutateAsync({ data: { pay_schedule: schedule, ...period } })
      await queryClient.invalidateQueries({ predicate: isFinanceQuery })
      navigate(`/settings/finance/payroll/${run.id}`)
    } catch (err: unknown) {
      setError(errorDetail(err, t('payroll.create.error')))
    }
  }

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[15vh]"
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
          {t('payroll.create.title')}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">{t('payroll.create.hint')}</p>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            {t('payroll.create.schedule')}
          </span>
          <Select
            block
            value={schedule}
            onChange={(e) => {
              const next = e.target.value as PaySchedule
              setSchedule(next)
              setPeriod(suggest(next))
            }}
          >
            {Object.values(PaySchedule).map((option) => (
              <option key={option} value={option}>
                {t(`compensation.schedules.${option}`)}
              </option>
            ))}
          </Select>
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              {t('payroll.create.start')}
            </span>
            <input
              type="date"
              required
              value={period.period_start}
              onChange={(e) => setPeriod({ ...period, period_start: e.target.value })}
              className="field"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              {t('payroll.create.end')}
            </span>
            <input
              type="date"
              required
              min={period.period_start}
              value={period.period_end}
              onChange={(e) => setPeriod({ ...period, period_end: e.target.value })}
              className="field"
            />
          </label>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger-600">
            {error}
          </p>
        )}

        <div className="hairline mt-5 flex justify-end gap-2 border-t pt-4">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:cancel')}
          </button>
          <button type="submit" disabled={createRun.isPending} className="btn btn-primary">
            {createRun.isPending ? t('payroll.create.submitting') : t('payroll.create.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
