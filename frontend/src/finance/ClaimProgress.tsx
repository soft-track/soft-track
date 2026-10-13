import { parseServerDate } from '@/api/dates'
import type { ExpenseRead } from '@/api/generated/models'
import { settlementName } from '@/finance/settlement'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'

const onDay = (value: string) => formatDate(parseServerDate(value), 'd MMM yyyy')

/**
 * Where an approved claim is on its way back to the person who paid (#137):
 * "Approved · awaiting reimbursement", then "Reimbursed on 16 Sep 2026" --
 * the state that matters most to them, and the one finance-side bookkeeping
 * is worthless without.
 */
export function ClaimProgress({ claim }: { claim: ExpenseRead }) {
  const { t } = useTranslation('finance')
  const { settlement, reimbursed_at: reimbursedAt } = claim
  const name = settlement ? settlementName(settlement) : ''
  const where = !settlement
    ? claim.decided_by && claim.decided_at
      ? t('expenses.mine.approvedBy', {
          name: claim.decided_by.full_name,
          date: onDay(claim.decided_at),
        })
      : null
    : settlement.kind === 'batch'
      ? reimbursedAt && settlement.paid_by
        ? t('expenses.mine.inBatchPaid', { batch: name, name: settlement.paid_by.full_name })
        : t('expenses.mine.inBatch', { batch: name })
      : reimbursedAt
        ? t('expenses.mine.onRunPaid', { run: name })
        : t('expenses.mine.onRun', { run: name })

  return (
    <div className="mt-1.5 space-y-1 text-xs">
      <span
        className="chip"
        style={{
          ['--chip' as string]: reimbursedAt
            ? 'var(--color-accent-mint)'
            : 'var(--color-brand-500)',
        }}
      >
        {reimbursedAt
          ? t('expenses.mine.reimbursedOn', { date: onDay(reimbursedAt) })
          : t('expenses.mine.awaiting')}
      </span>
      {where && <p className="text-neutral-500">{where}</p>}
    </div>
  )
}
