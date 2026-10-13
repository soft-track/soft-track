import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import {
  useApproveReimbursementBatchFinanceReimbursementsBatchesBatchIdApprovePost,
  useDeleteReimbursementBatchFinanceReimbursementsBatchesBatchIdDelete,
  useGetReimbursementBatchFinanceReimbursementsBatchesBatchIdGet,
  useMarkReimbursementBatchPaidFinanceReimbursementsBatchesBatchIdPaidPost,
  useReleaseExpenseFinanceReimbursementsExpensesExpenseIdSettlementDelete,
} from '@/api/generated/endpoints/reimbursements/reimbursements'
import { downloadExport } from '@/finance/download'
import { formatDay } from '@/finance/money'
import { MoneyTotals } from '@/finance/MoneyTotals'
import { isFinanceQuery } from '@/finance/queries'
import { StateSteps } from '@/finance/StateSteps'
import { useCurrencies } from '@/finance/useCurrencies'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

const onDay = (value: string) => formatDate(parseServerDate(value), 'd MMM yyyy')

/**
 * One reimbursement batch (#137), run like a payroll run: a draft to check,
 * approved, exported per person per currency in the payroll bank template,
 * and marked paid -- which is the moment every claim in it says
 * "Reimbursed" to the person who paid.
 */
export default function ReimbursementBatchPage() {
  const { batchId = '' } = useParams()
  const { t } = useTranslation(['finance', 'common'])
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { format } = useCurrencies()
  const batch = useGetReimbursementBatchFinanceReimbursementsBatchesBatchIdGet(Number(batchId))
  const approve = useApproveReimbursementBatchFinanceReimbursementsBatchesBatchIdApprovePost()
  const markPaid = useMarkReimbursementBatchPaidFinanceReimbursementsBatchesBatchIdPaidPost()
  const remove = useDeleteReimbursementBatchFinanceReimbursementsBatchesBatchIdDelete()
  const release = useReleaseExpenseFinanceReimbursementsExpensesExpenseIdSettlementDelete()
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (batch.isPending) return <Loading label={t('reimbursements.batch.loading')} />
  if (!batch.data) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        {t('reimbursements.batch.notFound')}
      </div>
    )
  }
  const data = batch.data
  const draft = data.state === 'draft'

  const act = async (request: () => Promise<unknown>, then?: () => void) => {
    setError(null)
    try {
      await request()
      await queryClient.invalidateQueries({ predicate: isFinanceQuery })
      then?.()
    } catch (err: unknown) {
      setError(errorDetail(err, t('reimbursements.batch.error')))
    }
  }

  const onExport = async () => {
    setExporting(true)
    setError(null)
    try {
      await downloadExport(
        `/finance/reimbursements/batches/${data.id}/export`,
        `reimbursements-${data.label.toLowerCase()}.csv`,
      )
    } catch {
      setError(t('reimbursements.batch.exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <Link
          to="/settings/finance/reimbursements"
          className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
        >
          <Icon name="chevron-left" size={12} />
          {t('reimbursements.batch.back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="identifier text-lg font-semibold tracking-tight text-neutral-900">
              {data.label}
            </h1>
            <p className="mt-0.5 text-sm text-neutral-500">
              {t('reimbursements.batch.subtitle', {
                name: data.created_by.full_name,
                date: onDay(data.created_at),
                summary: t('reimbursements.batchPeople', {
                  count: data.claim_count,
                  people: data.people_count,
                }),
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {draft && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t('reimbursements.batch.confirmDelete'))) {
                    void act(
                      () => remove.mutateAsync({ batchId: data.id }),
                      () => navigate('/settings/finance/reimbursements'),
                    )
                  }
                }}
                className="btn btn-danger-ghost btn-sm"
              >
                {t('reimbursements.batch.deleteDraft')}
              </button>
            )}
            <button
              type="button"
              onClick={onExport}
              disabled={draft || exporting}
              title={draft ? t('reimbursements.batch.exportWaits') : undefined}
              className={clsx('btn', data.state === 'approved' ? 'btn-primary' : 'btn-secondary')}
            >
              <Icon name="download" size={15} />
              {exporting
                ? t('reimbursements.batch.exporting')
                : t('reimbursements.batch.exportCsv')}
            </button>
            {draft && (
              <button
                type="button"
                onClick={() => void act(() => approve.mutateAsync({ batchId: data.id }))}
                disabled={approve.isPending}
                className="btn btn-primary"
              >
                <Icon name="check" size={15} />
                {approve.isPending
                  ? t('reimbursements.batch.approving')
                  : t('reimbursements.batch.approve')}
              </button>
            )}
            {data.state === 'approved' && (
              <button
                type="button"
                onClick={() => void act(() => markPaid.mutateAsync({ batchId: data.id }))}
                disabled={markPaid.isPending}
                className="btn btn-secondary"
              >
                {t('reimbursements.batch.markPaid')}
              </button>
            )}
          </div>
        </div>
        <StateSteps state={data.state} />
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </p>
        )}
        {!draft && data.approved_by && data.approved_at && (
          <div className="mt-4 flex items-start gap-2 rounded-control border border-accent-mint/40 bg-accent-mint/10 px-3 py-2.5 text-sm text-neutral-700">
            <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-accent-mint" />
            <p>
              <Trans
                t={t}
                i18nKey={
                  data.state === 'paid'
                    ? 'reimbursements.batch.paidBy'
                    : 'reimbursements.batch.approvedBy'
                }
                values={
                  data.state === 'paid' && data.paid_by && data.paid_at
                    ? { name: data.paid_by.full_name, date: onDay(data.paid_at) }
                    : { name: data.approved_by.full_name, date: onDay(data.approved_at) }
                }
                components={{ strong: <strong className="font-semibold text-neutral-900" /> }}
                {...userText}
              />
            </p>
          </div>
        )}
      </div>

      <section className="glass-strong rounded-panel p-4 sm:p-6">
        <table className="w-full border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="eyebrow">
              <th scope="col" className="px-3 py-2 font-semibold">
                {t('reimbursements.batch.columns.person')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {t('reimbursements.batch.columns.claims')}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {t('reimbursements.batch.columns.total')}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => (
              <tr key={`${line.person.id}-${line.currency}`}>
                <td className="hairline border-t px-3 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <Avatar user={line.person} size={26} decorative />
                    <span className="font-medium text-neutral-900">{line.person.full_name}</span>
                  </span>
                </td>
                <td className="hairline border-t px-3 py-2.5 text-right tabular-nums text-neutral-600">
                  {line.claims}
                </td>
                <td className="hairline identifier border-t px-3 py-2.5 text-right font-medium tabular-nums text-neutral-900">
                  {format(line.amount_minor, line.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hairline mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-neutral-500">{t('reimbursements.batch.template')}</p>
          <MoneyTotals totals={data.totals} label={t('reimbursements.batch.totalsLabel')} />
        </div>
      </section>

      <section className="glass-strong rounded-panel p-4 sm:p-6">
        <h2 className="eyebrow mb-2">{t('reimbursements.batch.claimsTitle')}</h2>
        <ul>
          {data.claims.map((claim) => (
            <li
              key={claim.id}
              className="hairline flex items-center gap-3 border-t py-2.5 text-sm first:border-t-0"
            >
              <span className="w-36 shrink-0 truncate text-neutral-700">
                {claim.submitter.full_name}
              </span>
              <span className="min-w-0 flex-1 truncate text-neutral-900">{claim.description}</span>
              <span className="hidden shrink-0 text-xs text-neutral-400 sm:inline">
                {formatDay(claim.incurred_on)}
              </span>
              <span className="identifier shrink-0 tabular-nums text-neutral-900">
                {format(claim.amount_minor, claim.currency)}
              </span>
              {draft && (
                <button
                  type="button"
                  onClick={() =>
                    void act(
                      () => release.mutateAsync({ expenseId: claim.id }),
                      // The last claim out takes the draft batch with it.
                      data.claims.length === 1
                        ? () => navigate('/settings/finance/reimbursements')
                        : undefined,
                    )
                  }
                  aria-label={t('reimbursements.batch.takeOutLabel', {
                    description: claim.description,
                  })}
                  className="btn btn-ghost btn-xs"
                >
                  {t('reimbursements.batch.takeOut')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
