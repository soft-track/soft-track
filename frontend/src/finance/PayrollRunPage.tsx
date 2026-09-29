import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { type FormEvent, useId, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import {
  useApprovePayrollRunFinancePayrollRunsRunIdApprovePost,
  useClearPayrollAdjustmentFinancePayrollRunsRunIdLinesUserIdAdjustmentDelete,
  useDeletePayrollRunFinancePayrollRunsRunIdDelete,
  useGetPayrollRunFinancePayrollRunsRunIdGet,
  useMarkPayrollRunPaidFinancePayrollRunsRunIdPaidPost,
  useSetPayrollAdjustmentFinancePayrollRunsRunIdLinesUserIdAdjustmentPut,
} from '@/api/generated/endpoints/payroll/payroll'
import type { PayrollLineRead, PayrollRunRead, PayrollRunState } from '@/api/generated/models'
import { downloadExport } from '@/finance/download'
import { fromMinorUnits, toMinorUnits } from '@/finance/money'
import { MoneyTotals } from '@/finance/MoneyTotals'
import { periodRange, runTitle } from '@/finance/payrollPeriod'
import { isFinanceQuery } from '@/finance/queries'
import { RecordPayDialog } from '@/finance/RecordPayDialog'
import { useCurrencies } from '@/finance/useCurrencies'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatDate, formatList } from '@/i18n/format'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { useFocusTrap } from '@/ui/useFocusTrap'

const STEPS: PayrollRunState[] = ['draft', 'approved', 'paid']

const onDay = (value: string) => formatDate(parseServerDate(value), 'd MMM yyyy')

/**
 * One payroll run (#132): a draft to review, then a record.
 *
 * While it is a draft the lines follow compensation as it changes -- record
 * a missing person's pay and they are on it -- and a line takes a one-off
 * adjustment with its reason. Approving copies every amount onto its line
 * and the run stops changing; only then is there a CSV, which is the point:
 * the export is the product, the run is its provenance.
 */
export default function PayrollRunPage() {
  const { runId = '' } = useParams()
  const { t } = useTranslation(['finance', 'common'])
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const run = useGetPayrollRunFinancePayrollRunsRunIdGet(Number(runId))
  const markPaid = useMarkPayrollRunPaidFinancePayrollRunsRunIdPaidPost()
  const deleteRun = useDeletePayrollRunFinancePayrollRunsRunIdDelete()
  const [approving, setApproving] = useState(false)
  const [adjusting, setAdjusting] = useState<PayrollLineRead | null>(null)
  const [recordingFor, setRecordingFor] = useState<PayrollLineRead | null>(null)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (run.isPending) return <Loading label={t('payroll.run.loading')} />
  if (!run.data) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        {t('payroll.run.notFound')}
      </div>
    )
  }
  const data = run.data
  const draft = data.state === 'draft'
  const missing = data.lines.filter((line) => line.missing)
  const refresh = () => queryClient.invalidateQueries({ predicate: isFinanceQuery })

  const onExport = async () => {
    setExporting(true)
    setError(null)
    try {
      await downloadExport(
        `/finance/payroll/runs/${data.id}/export`,
        `payroll-${data.period_start}.csv`,
      )
    } catch {
      setError(t('payroll.run.exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  const onMarkPaid = async () => {
    setError(null)
    try {
      await markPaid.mutateAsync({ runId: data.id })
      await refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, t('payroll.approve.error')))
    }
  }

  const onDelete = async () => {
    if (!window.confirm(t('payroll.run.confirmDelete'))) return
    await deleteRun.mutateAsync({ runId: data.id })
    await refresh()
    navigate('/settings/finance/payroll')
  }

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <Link
          to="/settings/finance/payroll"
          className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
        >
          <Icon name="chevron-left" size={12} />
          {t('payroll.run.back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
              {runTitle(data)}
            </h1>
            <p className="mt-0.5 text-sm text-neutral-500">
              {t('payroll.run.subtitle', {
                schedule: t(`compensation.schedules.${data.pay_schedule}`),
                range: periodRange(data),
                name: data.created_by.full_name,
                date: onDay(data.created_at),
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {draft && (
              <button type="button" onClick={onDelete} className="btn btn-danger-ghost btn-sm">
                {t('payroll.run.deleteDraft')}
              </button>
            )}
            <button
              type="button"
              onClick={onExport}
              disabled={draft || exporting}
              title={draft ? t('payroll.run.exportWaits') : undefined}
              className={clsx('btn', data.state === 'approved' ? 'btn-primary' : 'btn-secondary')}
            >
              <Icon name="download" size={15} />
              {exporting ? t('payroll.run.exporting') : t('payroll.run.exportCsv')}
            </button>
            {draft && (
              <button type="button" onClick={() => setApproving(true)} className="btn btn-primary">
                <Icon name="check" size={15} />
                {t('payroll.run.approve')}
              </button>
            )}
            {data.state === 'approved' && (
              <button
                type="button"
                onClick={onMarkPaid}
                disabled={markPaid.isPending}
                className="btn btn-secondary"
              >
                {markPaid.isPending ? t('payroll.run.markingPaid') : t('payroll.run.markPaid')}
              </button>
            )}
          </div>
        </div>

        <Steps state={data.state} />

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </p>
        )}

        {draft && missing.length > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded-control border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-neutral-700">
            <Icon name="flag" size={15} className="mt-0.5 shrink-0 text-danger-600" />
            <p>
              <Trans
                t={t}
                i18nKey="payroll.run.missing"
                count={missing.length}
                values={{
                  count: missing.length,
                  names: formatList(missing.map((line) => line.person.full_name)),
                }}
                components={{ strong: <strong className="font-semibold text-neutral-900" /> }}
                {...userText}
              />
            </p>
          </div>
        )}
        {data.state !== 'draft' && data.approved_by && data.approved_at && (
          <div className="mt-4 flex items-start gap-2 rounded-control border border-accent-mint/40 bg-accent-mint/10 px-3 py-2.5 text-sm text-neutral-700">
            <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-accent-mint" />
            <p>
              {data.state === 'paid' && data.paid_by && data.paid_at ? (
                <Trans
                  t={t}
                  i18nKey="payroll.run.paidBy"
                  values={{
                    name: data.paid_by.full_name,
                    date: onDay(data.paid_at),
                    approver: data.approved_by.full_name,
                    approvedOn: onDay(data.approved_at),
                  }}
                  components={{ strong: <strong className="font-semibold text-neutral-900" /> }}
                  {...userText}
                />
              ) : (
                <Trans
                  t={t}
                  i18nKey="payroll.run.approvedBy"
                  values={{ name: data.approved_by.full_name, date: onDay(data.approved_at) }}
                  components={{ strong: <strong className="font-semibold text-neutral-900" /> }}
                  {...userText}
                />
              )}
            </p>
          </div>
        )}
      </div>

      <section className="glass-strong rounded-panel p-4 sm:p-6">
        <div className="overflow-x-auto">
          <LinesTable run={data} onAdjust={setAdjusting} onRecordPay={setRecordingFor} />
        </div>
        <div className="hairline mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-neutral-500">
            {t('payroll.run.lines', { count: data.line_count - data.missing_count })}
            {data.missing_count > 0 && (
              <>
                {' · '}
                <span className="text-danger-600">
                  {t('payroll.run.missingLines', { count: data.missing_count })}
                </span>
              </>
            )}
          </p>
          <MoneyTotals totals={data.totals} label={t('payroll.run.totalsLabel')} />
        </div>
        {draft && <p className="mt-3 text-xs text-neutral-400">{t('payroll.run.liveHint')}</p>}
      </section>

      {approving && (
        <ApproveDialog run={data} missing={missing} onClose={() => setApproving(false)} />
      )}
      {adjusting && (
        <AdjustmentDialog run={data} line={adjusting} onClose={() => setAdjusting(null)} />
      )}
      {recordingFor && (
        <RecordPayDialog person={recordingFor.person} onClose={() => setRecordingFor(null)} />
      )}
    </div>
  )
}

/** Draft — Approved — Paid, with the ones behind it ticked. */
function Steps({ state }: { state: PayrollRunState }) {
  const { t } = useTranslation('finance')
  const at = STEPS.indexOf(state)
  return (
    <ol aria-label={t('payroll.run.steps')} className="mt-4 flex flex-wrap items-center gap-2">
      {STEPS.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          {index > 0 && <span aria-hidden="true" className="h-px w-6 bg-neutral-900/15" />}
          <span
            aria-current={index === at ? 'step' : undefined}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
              index === at && 'border-brand-500/40 bg-brand-500/10 text-brand-700',
              index < at && 'border-accent-mint/40 bg-accent-mint/10 text-neutral-700',
              index > at && 'border-neutral-900/10 text-neutral-400',
            )}
          >
            {index < at ? (
              <Icon name="check" size={11} />
            ) : (
              <span className="text-[10px] tabular-nums">{index + 1}</span>
            )}
            {t(`payroll.states.${step}`)}
          </span>
        </li>
      ))}
    </ol>
  )
}

function LinesTable({
  run,
  onAdjust,
  onRecordPay,
}: {
  run: PayrollRunRead
  onAdjust: (line: PayrollLineRead) => void
  onRecordPay: (line: PayrollLineRead) => void
}) {
  const { t } = useTranslation(['finance', 'common'])
  const { format } = useCurrencies()
  const draft = run.state === 'draft'
  const cell = 'hairline border-t px-3 py-2.5'
  return (
    <table className="w-full border-separate border-spacing-0 text-left text-sm">
      <thead>
        <tr className="eyebrow">
          <th scope="col" className="px-3 py-2 font-semibold">
            {t('payroll.run.columns.person')}
          </th>
          <th scope="col" className="hidden px-3 py-2 font-semibold md:table-cell">
            {t('payroll.run.columns.department')}
          </th>
          <th scope="col" className="px-3 py-2 text-right font-semibold">
            {t('payroll.run.columns.compensation')}
          </th>
          <th scope="col" className="px-3 py-2 font-semibold">
            {t('payroll.run.columns.adjustment')}
          </th>
          <th scope="col" className="px-3 py-2 text-right font-semibold">
            {t('payroll.run.columns.total')}
          </th>
        </tr>
      </thead>
      <tbody>
        {run.lines.map((line) => (
          <tr key={line.person.id} className={clsx(line.missing && 'bg-danger-50/60')}>
            <td className={cell}>
              <span className="flex items-center gap-2.5">
                <Avatar user={line.person} size={26} decorative />
                <span className="font-medium text-neutral-900">{line.person.full_name}</span>
              </span>
            </td>
            <td className={`${cell} hidden text-neutral-600 md:table-cell`}>
              {line.department?.name ?? t('payroll.run.noDepartment')}
            </td>
            <td className={`${cell} identifier text-right tabular-nums text-neutral-700`}>
              {line.amount_minor != null && line.currency
                ? format(line.amount_minor, line.currency)
                : '—'}
            </td>
            <td className={cell}>
              {line.missing ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className="chip"
                    style={{ ['--chip' as string]: 'var(--color-danger-500)' }}
                  >
                    {t('payroll.run.noCompensation')}
                  </span>
                  {draft && (
                    <button
                      type="button"
                      onClick={() => onRecordPay(line)}
                      aria-label={t('payroll.run.recordPayFor', { name: line.person.full_name })}
                      className="btn btn-ghost btn-xs"
                    >
                      {t('payroll.run.recordPay')}
                    </button>
                  )}
                </span>
              ) : line.adjustment_minor !== 0 && line.currency ? (
                <button
                  type="button"
                  disabled={!draft}
                  onClick={() => onAdjust(line)}
                  aria-label={
                    draft
                      ? t('payroll.run.editAdjustmentFor', { name: line.person.full_name })
                      : undefined
                  }
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-brand-500/10 px-2 py-0.5 text-xs text-neutral-700 enabled:hover:bg-brand-500/15 disabled:cursor-default"
                >
                  <span className="identifier font-semibold text-brand-700">
                    {line.adjustment_minor > 0 && '+'}
                    {format(line.adjustment_minor, line.currency)}
                  </span>
                  <span className="truncate">{line.adjustment_note}</span>
                </button>
              ) : (
                draft && (
                  <button
                    type="button"
                    onClick={() => onAdjust(line)}
                    aria-label={t('payroll.run.addAdjustmentFor', { name: line.person.full_name })}
                    className="text-xs text-neutral-400 hover:text-neutral-700"
                  >
                    {t('payroll.run.addAdjustment')}
                  </button>
                )
              )}
            </td>
            <td
              className={`${cell} identifier text-right font-medium tabular-nums text-neutral-900`}
            >
              {line.total_minor != null && line.currency
                ? format(line.total_minor, line.currency)
                : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** A one-off amount on a line, positive or negative, and why. */
function AdjustmentDialog({
  run,
  line,
  onClose,
}: {
  run: PayrollRunRead
  line: PayrollLineRead
  onClose: () => void
}) {
  const { t } = useTranslation(['finance', 'common'])
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const queryClient = useQueryClient()
  const { placesOf } = useCurrencies()
  const setAdjustment = useSetPayrollAdjustmentFinancePayrollRunsRunIdLinesUserIdAdjustmentPut()
  const clearAdjustment =
    useClearPayrollAdjustmentFinancePayrollRunsRunIdLinesUserIdAdjustmentDelete()
  const currency = line.currency ?? 'USD'
  const places = placesOf(currency)
  const existing = line.adjustment_minor !== 0
  const [amount, setAmount] = useState(
    existing
      ? `${line.adjustment_minor < 0 ? '-' : ''}${fromMinorUnits(Math.abs(line.adjustment_minor), places)}`
      : '',
  )
  const [note, setNote] = useState(line.adjustment_note ?? '')
  const [error, setError] = useState<string | null>(null)

  const trimmed = amount.trim()
  const negative = trimmed.startsWith('-')
  const magnitude = toMinorUnits(trimmed.replace(/^[+-]/, ''), places)
  const minor = magnitude === null || magnitude === 0 ? null : negative ? -magnitude : magnitude

  const done = async (request: Promise<unknown>) => {
    setError(null)
    try {
      await request
      await queryClient.invalidateQueries({ predicate: isFinanceQuery })
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('payroll.adjustment.error')))
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (minor === null || !note.trim()) return
    void done(
      setAdjustment.mutateAsync({
        runId: run.id,
        userId: line.person.id,
        data: { amount_minor: minor, note: note.trim() },
      }),
    )
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
        className="pop-in glass-strong w-full max-w-sm rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('payroll.adjustment.title', { name: line.person.full_name })}
        </h2>
        <div className="mt-4">
          <label
            htmlFor={`${titleId}-amount`}
            className="mb-1 block text-xs font-medium text-neutral-500"
          >
            {t('payroll.adjustment.amount')}
          </label>
          <input
            id={`${titleId}-amount`}
            autoFocus
            inputMode="decimal"
            autoComplete="off"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={trimmed && minor === null ? true : undefined}
            className="field tabular-nums"
          />
          <span className="mt-1 block text-xs text-neutral-400">
            {trimmed && minor === null ? (
              <span className="text-danger-600">
                {t('payroll.adjustment.invalid', { count: places })}
              </span>
            ) : (
              t('payroll.adjustment.amountHint', { currency })
            )}
          </span>
        </div>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            {t('payroll.adjustment.note')}
          </span>
          <input
            required
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('payroll.adjustment.notePlaceholder')}
            className="field"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger-600">
            {error}
          </p>
        )}

        <div className="hairline mt-5 flex items-center justify-between gap-2 border-t pt-4">
          {existing ? (
            <button
              type="button"
              onClick={() =>
                void done(clearAdjustment.mutateAsync({ runId: run.id, userId: line.person.id }))
              }
              className="btn btn-danger-ghost btn-sm"
            >
              {t('payroll.adjustment.remove')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost">
              {t('common:cancel')}
            </button>
            <button
              type="submit"
              disabled={minor === null || !note.trim() || setAdjustment.isPending}
              className="btn btn-primary"
            >
              {t('payroll.adjustment.save')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

/** Approving: what freezes, and who this run will not pay. */
function ApproveDialog({
  run,
  missing,
  onClose,
}: {
  run: PayrollRunRead
  missing: PayrollLineRead[]
  onClose: () => void
}) {
  const { t } = useTranslation(['finance', 'common'])
  const dialogRef = useFocusTrap<HTMLDivElement>()
  const titleId = useId()
  const queryClient = useQueryClient()
  const approve = useApprovePayrollRunFinancePayrollRunsRunIdApprovePost()
  const [error, setError] = useState<string | null>(null)

  const onApprove = async () => {
    setError(null)
    try {
      await approve.mutateAsync({ runId: run.id })
      await queryClient.invalidateQueries({ predicate: isFinanceQuery })
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('payroll.approve.error')))
    }
  }

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[15vh]"
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
        className="pop-in glass-strong w-full max-w-md rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('payroll.approve.title', { run: runTitle(run) })}
        </h2>
        <p className="mt-2 text-sm text-neutral-600">{t('payroll.approve.body')}</p>
        {missing.length > 0 && (
          <p className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {t('payroll.approve.missing', {
              count: missing.length,
              names: formatList(missing.map((line) => line.person.full_name)),
            })}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-xs text-danger-600">
            {error}
          </p>
        )}
        <div className="hairline mt-4 flex justify-end gap-2 border-t pt-4">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            {t('common:cancel')}
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={approve.isPending}
            className="btn btn-primary"
          >
            <Icon name="check" size={15} />
            {approve.isPending ? t('payroll.approve.submitting') : t('payroll.approve.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
