import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import {
  useListMyExpensesExpensesGet,
  useWithdrawExpenseExpensesExpenseIdDelete,
} from '@/api/generated/endpoints/expenses/expenses'
import type { Currency, ExpenseRead } from '@/api/generated/models'
import { downloadAttachment, formatBytes } from '@/attachments/urls'
import { ExpenseDialog } from '@/finance/ExpenseDialog'
import { ExpenseStateChip } from '@/finance/ExpenseStateChip'
import { formatDay } from '@/finance/money'
import { isExpenseQuery } from '@/finance/queries'
import { useCurrencies } from '@/finance/useCurrencies'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

/**
 * Settings → Expenses (#133): your own claims, for anybody signed in.
 *
 * Only yours -- the API has no way to ask for anybody else's -- with where
 * each one stands. A waiting claim can be changed or withdrawn; a decided one
 * says who decided it, and a refusal says why.
 */
export default function MyExpensesPage() {
  const { t } = useTranslation(['finance', 'common'])
  const queryClient = useQueryClient()
  const { format } = useCurrencies()
  const mine = useListMyExpensesExpensesGet({ limit: 200 })
  const withdraw = useWithdrawExpenseExpensesExpenseIdDelete()
  const [editing, setEditing] = useState<ExpenseRead | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const claims = mine.data?.items ?? []
  // A new claim starts in the currency of the last one.
  const lastCurrency: Currency = claims[0]?.currency ?? 'USD'

  const onWithdraw = async (claim: ExpenseRead) => {
    if (!window.confirm(t('expenses.mine.confirmWithdraw', { description: claim.description }))) {
      return
    }
    setError(null)
    try {
      await withdraw.mutateAsync({ expenseId: claim.id })
      await queryClient.invalidateQueries({ predicate: isExpenseQuery })
    } catch (err: unknown) {
      setError(errorDetail(err, t('expenses.mine.error')))
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
              {t('expenses.mine.title')}
            </h1>
            <p className="mt-1 max-w-prose text-sm text-neutral-500">{t('expenses.mine.intro')}</p>
          </div>
          <button type="button" onClick={() => setEditing('new')} className="btn btn-primary">
            <Icon name="plus" size={15} />
            {t('expenses.mine.newExpense')}
          </button>
        </div>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </p>
        )}
      </div>

      <section className="glass-strong rounded-panel p-4 sm:p-6">
        {mine.isPending ? (
          <Loading label={t('expenses.mine.loading')} />
        ) : claims.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('expenses.mine.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {claims.map((claim) => (
              <li key={claim.id} className="well rounded-card px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="min-w-0 font-medium text-neutral-900">{claim.description}</p>
                  <p className="identifier font-medium tabular-nums text-neutral-900">
                    {format(claim.amount_minor, claim.currency)}
                  </p>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-neutral-500">
                  <ExpenseStateChip state={claim.state} />
                  <span>{t('expenses.mine.incurred', { date: formatDay(claim.incurred_on) })}</span>
                  {claim.receipt ? (
                    <button
                      type="button"
                      onClick={() =>
                        claim.receipt &&
                        void downloadAttachment(claim.receipt.url, claim.receipt.filename)
                      }
                      className="inline-flex items-center gap-1 hover:text-neutral-800"
                    >
                      <Icon name="paperclip" size={11} />
                      {claim.receipt.filename} · {formatBytes(claim.receipt.size_bytes)}
                    </button>
                  ) : (
                    <span className="text-neutral-400">{t('expenses.mine.noReceipt')}</span>
                  )}
                  {claim.state === 'submitted' && (
                    <span className="ml-auto flex gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(claim)}
                        aria-label={t('expenses.mine.editLabel', {
                          description: claim.description,
                        })}
                        className="btn btn-ghost btn-xs"
                      >
                        {t('expenses.mine.edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onWithdraw(claim)}
                        aria-label={t('expenses.mine.withdrawLabel', {
                          description: claim.description,
                        })}
                        className="btn btn-danger-ghost btn-xs"
                      >
                        {t('expenses.mine.withdraw')}
                      </button>
                    </span>
                  )}
                </div>
                {claim.state === 'approved' && claim.decided_by && claim.decided_at && (
                  <p className="mt-1.5 text-xs text-neutral-500">
                    {t('expenses.mine.approvedBy', {
                      name: claim.decided_by.full_name,
                      date: formatDate(parseServerDate(claim.decided_at), 'd MMM yyyy'),
                    })}
                  </p>
                )}
                {claim.state === 'refused' && claim.decided_by && (
                  <p className="mt-1.5 text-xs text-neutral-600">
                    {t('expenses.mine.refusedBy', {
                      reason: claim.refusal_reason ?? '',
                      name: claim.decided_by.full_name,
                    })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <ExpenseDialog
          expense={editing === 'new' ? undefined : editing}
          defaultCurrency={lastCurrency}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
