import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { type FormEvent, useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { useListPayrollRunsFinancePayrollRunsGet } from '@/api/generated/endpoints/payroll/payroll'
import {
  useCarryOnPayrollRunFinanceReimbursementsCarryPost,
  useCreateReimbursementBatchFinanceReimbursementsBatchesPost,
  useListAwaitingReimbursementFinanceReimbursementsAwaitingGet,
  useListReimbursementBatchesFinanceReimbursementsBatchesGet,
} from '@/api/generated/endpoints/reimbursements/reimbursements'
import type { ClaimRead } from '@/api/generated/models'
import { MoneyTotals } from '@/finance/MoneyTotals'
import { PayrollStateChip } from '@/finance/PayrollStateChip'
import { runTitle } from '@/finance/payrollPeriod'
import { isFinanceQuery } from '@/finance/queries'
import { settlementName } from '@/finance/settlement'
import { useCurrencies } from '@/finance/useCurrencies'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'
import { useFocusTrap } from '@/ui/useFocusTrap'

type Tab = 'awaiting' | 'batches'

/** Per-currency sums of some claims -- never across currencies. */
function sums(claims: ClaimRead[]) {
  const totals = new Map<string, number>()
  for (const claim of claims) {
    totals.set(claim.currency, (totals.get(claim.currency) ?? 0) + claim.amount_minor)
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount_minor]) => ({ currency, amount_minor }))
}

/**
 * Finance → Reimbursements (#137): approved claims the company owes, and the
 * batches that paid them back.
 *
 * Choose claims and pay them back in a batch of their own, or carry them on
 * a draft payroll run beside each person's pay. A claim already going out --
 * in a draft batch, on a draft run -- says where and cannot be chosen again:
 * the rule is the database's, and this only says it first.
 */
export default function ReimbursementsPage() {
  const { t } = useTranslation(['finance', 'common'])
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { format } = useCurrencies()
  const [tab, setTab] = useState<Tab>('awaiting')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [carrying, setCarrying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const awaiting = useListAwaitingReimbursementFinanceReimbursementsAwaitingGet()
  const batches = useListReimbursementBatchesFinanceReimbursementsBatchesGet({ limit: 50 })
  const createBatch = useCreateReimbursementBatchFinanceReimbursementsBatchesPost()
  const claims = awaiting.data ?? []
  const chosen = claims.filter((claim) => selected.has(claim.id))

  const toggle = (id: number) =>
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const onNewBatch = async () => {
    setError(null)
    try {
      const batch = await createBatch.mutateAsync({ data: { expense_ids: [...selected] } })
      await queryClient.invalidateQueries({ predicate: isFinanceQuery })
      navigate(`/settings/finance/reimbursements/batches/${batch.id}`)
    } catch (err: unknown) {
      setError(errorDetail(err, t('reimbursements.error')))
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          {t('reimbursements.title')}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-neutral-500">{t('reimbursements.intro')}</p>
        <div className="segmented mt-5" role="group" aria-label={t('reimbursements.tabs.label')}>
          {(['awaiting', 'batches'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={tab === option}
              data-active={tab === option}
              onClick={() => setTab(option)}
              className="segmented-item"
            >
              {option === 'awaiting'
                ? t('reimbursements.tabs.awaiting', { count: claims.length })
                : t('reimbursements.tabs.batches')}
            </button>
          ))}
        </div>
      </div>

      {tab === 'awaiting' ? (
        <section className="glass-strong rounded-panel p-3 sm:p-4">
          {awaiting.isPending ? (
            <Loading label={t('reimbursements.loading')} />
          ) : claims.length === 0 ? (
            <p className="p-3 text-sm text-neutral-500">{t('reimbursements.emptyAwaiting')}</p>
          ) : (
            <ul>
              {claims.map((claim) => {
                const taken = claim.settlement
                return (
                  <li
                    key={claim.id}
                    className={clsx(
                      'hairline flex items-center gap-3 border-t px-2 py-2.5 text-sm first:border-t-0',
                      taken && 'opacity-60',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(claim.id)}
                      disabled={Boolean(taken)}
                      onChange={() => toggle(claim.id)}
                      aria-label={t('reimbursements.select', { description: claim.description })}
                      className="h-4 w-4 shrink-0 accent-brand-600"
                    />
                    <Avatar user={claim.submitter} size={26} decorative />
                    <span className="w-32 shrink-0 truncate font-medium text-neutral-900">
                      {claim.submitter.full_name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-neutral-700">
                      {claim.description}
                    </span>
                    <span className="identifier shrink-0 tabular-nums text-neutral-900">
                      {format(claim.amount_minor, claim.currency)}
                    </span>
                    <span className="hidden w-40 shrink-0 text-right text-xs text-neutral-500 sm:inline">
                      {taken
                        ? taken.kind === 'batch'
                          ? t('reimbursements.inBatch', {
                              batch: settlementName(taken),
                              state: t(`payroll.states.${taken.state}`).toLowerCase(),
                            })
                          : t('reimbursements.onRun', {
                              run: settlementName(taken),
                              state: t(`payroll.states.${taken.state}`).toLowerCase(),
                            })
                        : claim.decided_at &&
                          t('reimbursements.approvedOn', {
                            date: formatDate(parseServerDate(claim.decided_at), 'd MMM'),
                          })}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}

          {chosen.length > 0 && (
            <div className="well mt-3 flex flex-wrap items-center gap-3 rounded-card px-4 py-3">
              <p className="text-sm font-medium text-neutral-900">
                {t('reimbursements.selected', { count: chosen.length })}
              </p>
              <MoneyTotals totals={sums(chosen)} label={t('reimbursements.batch.totalsLabel')} />
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCarrying(true)}
                  className="btn btn-secondary btn-sm"
                >
                  <Icon name="calendar" size={14} />
                  {t('reimbursements.carry')}
                </button>
                <button
                  type="button"
                  onClick={onNewBatch}
                  disabled={createBatch.isPending}
                  className="btn btn-primary btn-sm"
                >
                  <Icon name="plus" size={14} />
                  {createBatch.isPending
                    ? t('reimbursements.creating')
                    : t('reimbursements.newBatch')}
                </button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-danger-600">
              {error}
            </p>
          )}
        </section>
      ) : (
        <section className="glass-strong rounded-panel p-4 sm:p-6">
          {batches.isPending ? (
            <Loading label={t('reimbursements.loading')} />
          ) : (batches.data?.items ?? []).length === 0 ? (
            <p className="text-sm text-neutral-500">{t('reimbursements.emptyBatches')}</p>
          ) : (
            <table className="w-full border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr className="eyebrow">
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t('reimbursements.columns.batch')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t('reimbursements.columns.state')}
                  </th>
                  <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">
                    {t('reimbursements.columns.claims')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t('reimbursements.columns.totals')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(batches.data?.items ?? []).map((batch) => (
                  <tr key={batch.id}>
                    <td className="hairline border-t px-3 py-3">
                      <Link
                        to={`/settings/finance/reimbursements/batches/${batch.id}`}
                        className="identifier font-medium text-neutral-900 hover:underline"
                      >
                        {batch.label}
                      </Link>
                    </td>
                    <td className="hairline border-t px-3 py-3">
                      <PayrollStateChip state={batch.state} />
                    </td>
                    <td className="hairline hidden border-t px-3 py-3 text-neutral-600 sm:table-cell">
                      {t('reimbursements.batchPeople', {
                        count: batch.claim_count,
                        people: batch.people_count,
                      })}
                    </td>
                    <td className="hairline border-t px-3 py-3">
                      <MoneyTotals
                        totals={batch.totals}
                        label={t('reimbursements.batch.totalsLabel')}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {carrying && (
        <CarryDialog
          expenseIds={[...selected]}
          onClose={() => setCarrying(false)}
          onCarried={(runId) => navigate(`/settings/finance/payroll/${runId}`)}
        />
      )}
    </div>
  )
}

/** Choosing the draft payroll run that pays the claims back. */
function CarryDialog({
  expenseIds,
  onClose,
  onCarried,
}: {
  expenseIds: number[]
  onClose: () => void
  onCarried: (runId: number) => void
}) {
  const { t } = useTranslation(['finance', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const queryClient = useQueryClient()
  const runs = useListPayrollRunsFinancePayrollRunsGet({ limit: 50 })
  const carry = useCarryOnPayrollRunFinanceReimbursementsCarryPost()
  // The earliest draft first: "the next payroll run".
  const drafts = (runs.data?.items ?? [])
    .filter((run) => run.state === 'draft')
    .sort((a, b) => a.period_start.localeCompare(b.period_start))
  const [runId, setRunId] = useState<number | null>(null)
  const chosen = runId ?? drafts[0]?.id ?? null
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (chosen === null) return
    setError(null)
    try {
      await carry.mutateAsync({ data: { run_id: chosen, expense_ids: expenseIds } })
      await queryClient.invalidateQueries({ predicate: isFinanceQuery })
      onCarried(chosen)
    } catch (err: unknown) {
      setError(errorDetail(err, t('reimbursements.carryDialog.error')))
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
          {t('reimbursements.carryDialog.title')}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">{t('reimbursements.carryDialog.body')}</p>
        {drafts.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-600">{t('reimbursements.carryDialog.noRuns')}</p>
        ) : (
          <label className="mt-4 block">
            <span className="mb-1 block text-xs font-medium text-neutral-500">
              {t('reimbursements.carryDialog.run')}
            </span>
            <Select block value={chosen ?? ''} onChange={(e) => setRunId(Number(e.target.value))}>
              {drafts.map((run) => (
                <option key={run.id} value={run.id}>
                  {runTitle(run)} · {t(`compensation.schedules.${run.pay_schedule}`)}
                </option>
              ))}
            </Select>
          </label>
        )}
        {error && (
          <p role="alert" className="mt-3 text-xs text-danger-600">
            {error}
          </p>
        )}
        <div className="hairline mt-5 flex justify-end gap-2 border-t pt-4">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:cancel')}
          </button>
          <button
            type="submit"
            disabled={chosen === null || carry.isPending}
            className="btn btn-primary"
          >
            {carry.isPending
              ? t('reimbursements.carryDialog.submitting')
              : t('reimbursements.carryDialog.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
