import { keepPreviousData, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { type FormEvent, useId, useState } from 'react'
import { createPortal } from 'react-dom'

import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import {
  useApproveExpenseFinanceExpensesExpenseIdApprovePost,
  useGetExpenseClaimFinanceExpensesExpenseIdGet,
  useListExpenseClaimsFinanceExpensesGet,
  useRefuseExpenseFinanceExpensesExpenseIdRefusePost,
} from '@/api/generated/endpoints/expense-claims/expense-claims'
import { useListPeopleUsersGet } from '@/api/generated/endpoints/people/people'
import type { ClaimRead, ExpenseState } from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import { ExpenseStateChip } from '@/finance/ExpenseStateChip'
import { formatDay } from '@/finance/money'
import { isExpenseQuery } from '@/finance/queries'
import { ReceiptPreview } from '@/finance/ReceiptPreview'
import { settlementName } from '@/finance/settlement'
import { useCurrencies } from '@/finance/useCurrencies'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { type PersonOption, PersonPicker } from '@/people/PersonPicker'
import { useDebounced } from '@/search/useDebounced'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { useFocusTrap } from '@/ui/useFocusTrap'

const PAGE_SIZE = 50
const STATES: (ExpenseState | null)[] = ['submitted', 'approved', 'refused', null]

const onDay = (value: string) => formatDate(parseServerDate(value), 'd MMM yyyy')

/**
 * Finance → Expense claims (#133): the review queue.
 *
 * Every claim, filtered by state and person, with the one chosen beside it:
 * its receipt, and Approve or Refuse. The decision is finance's -- not the
 * manager chain's, and never the claimant's own, which the page says rather
 * than offering buttons the server would refuse.
 */
export default function ExpenseClaimsPage() {
  const { t } = useTranslation(['finance', 'common'])
  const { format } = useCurrencies()
  const [state, setState] = useState<ExpenseState | null>('submitted')
  const [person, setPerson] = useState<PersonOption | null>(null)
  const [search, setSearch] = useState('')
  const query = useDebounced(search, 200)
  const candidates = useListPeopleUsersGet({ q: query || undefined, limit: 8 })
  const [offset, setOffset] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const claims = useListExpenseClaimsFinanceExpensesGet(
    {
      state: state ?? undefined,
      submitter_id: person?.id,
      limit: PAGE_SIZE,
      offset,
    },
    { query: { placeholderData: keepPreviousData } },
  )
  const items = claims.data?.items ?? []
  const total = claims.data?.total ?? 0
  const counts = claims.data?.counts

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
          {t('expenses.claims.title')}
        </h1>
        <p className="mt-1 max-w-prose text-sm text-neutral-500">{t('expenses.claims.intro')}</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="segmented" role="group" aria-label={t('expenses.claims.stateLabel')}>
            {STATES.map((option) => {
              const label = option ? t(`expenses.states.${option}`) : t('expenses.claims.all')
              const count = option && counts ? counts[option] : null
              return (
                <button
                  key={option ?? 'all'}
                  type="button"
                  aria-pressed={state === option}
                  data-active={state === option}
                  onClick={() => {
                    setState(option)
                    setOffset(0)
                  }}
                  className="segmented-item"
                >
                  {label}
                  {count ? (
                    <span className="rounded-full bg-neutral-900/8 px-1.5 text-[10px] tabular-nums">
                      {count}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
          <div className="w-56">
            <PersonPicker
              label={t('expenses.claims.person')}
              value={person}
              results={candidates.data?.items ?? []}
              onSearch={setSearch}
              onChange={(next) => {
                setPerson(next)
                setOffset(0)
              }}
              noneLabel={t('expenses.claims.anyone')}
              placeholder={t('expenses.claims.searchPeople')}
            />
          </div>
        </div>
      </div>

      {/* Side by side only where both fit; the list keeps two lines a row so
          it reads at any width. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <section className="glass-strong self-start rounded-panel p-2 sm:p-3">
          {claims.isPending ? (
            <Loading label={t('expenses.claims.loading')} />
          ) : items.length === 0 ? (
            <p className="p-4 text-sm text-neutral-500">
              {state === 'submitted' && !person
                ? t('expenses.claims.emptyWaiting')
                : t('expenses.claims.empty')}
            </p>
          ) : (
            <ul>
              {items.map((claim) => (
                <li key={claim.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(claim.id)}
                    aria-current={selectedId === claim.id ? 'true' : undefined}
                    className={clsx(
                      'flex w-full items-start gap-3 rounded-card px-3 py-2.5 text-left text-sm',
                      selectedId === claim.id ? 'bg-brand-500/10' : 'hover:bg-neutral-900/4',
                    )}
                  >
                    <Avatar user={claim.submitter} size={30} decorative />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium text-neutral-900">
                          {claim.submitter.full_name}
                        </span>
                        <span className="identifier shrink-0 tabular-nums text-neutral-900">
                          {format(claim.amount_minor, claim.currency)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-neutral-500">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Icon
                            name={claim.receipt ? 'paperclip' : 'receipt'}
                            size={12}
                            className={clsx(
                              'shrink-0',
                              claim.receipt ? 'text-neutral-400' : 'text-neutral-300',
                            )}
                          />
                          <span className="truncate">{claim.description}</span>
                          <span className="shrink-0 text-neutral-400">
                            · {formatDay(claim.incurred_on)}
                          </span>
                        </span>
                        <ExpenseStateChip state={claim.state} />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {total > PAGE_SIZE && (
            <div className="hairline mt-2 flex items-center justify-between border-t px-2 pt-3">
              <p className="text-xs text-neutral-400">
                {t('expenses.claims.showing', {
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
                  {t('expenses.claims.previous')}
                </button>
                <button
                  type="button"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  className="btn btn-ghost btn-sm"
                >
                  {t('expenses.claims.next')}
                </button>
              </div>
            </div>
          )}
        </section>

        {selectedId === null ? (
          <p className="glass rounded-panel p-6 text-sm text-neutral-500">
            {t('expenses.claims.select')}
          </p>
        ) : (
          <ClaimPanel claimId={selectedId} />
        )}
      </div>
    </div>
  )
}

/** One claim, its receipt, and the decision. */
function ClaimPanel({ claimId }: { claimId: number }) {
  const { t } = useTranslation(['finance', 'common'])
  const { user } = useAuth()
  const { format } = useCurrencies()
  const queryClient = useQueryClient()
  const claim = useGetExpenseClaimFinanceExpensesExpenseIdGet(claimId)
  const approve = useApproveExpenseFinanceExpensesExpenseIdApprovePost()
  const [refusing, setRefusing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!claim.data) return <Loading label={t('expenses.claims.loading')} />
  const data = claim.data
  const own = data.submitter.id === user?.id
  const facts = [
    data.submitter.job_title,
    data.department?.name ?? t('expenses.claims.noDepartment'),
  ]
    .filter(Boolean)
    .join(' · ')

  const onApprove = async () => {
    setError(null)
    try {
      await approve.mutateAsync({ expenseId: data.id })
      await queryClient.invalidateQueries({ predicate: isExpenseQuery })
    } catch (err: unknown) {
      setError(errorDetail(err, t('expenses.claims.error')))
    }
  }

  return (
    <aside className="glass-strong self-start rounded-panel p-5 lg:sticky lg:top-6">
      <div className="flex items-start gap-3">
        <Avatar user={data.submitter} size={34} decorative />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-neutral-900">{data.submitter.full_name}</p>
          <p className="truncate text-xs text-neutral-500">{facts}</p>
        </div>
        <ExpenseStateChip state={data.state} />
      </div>

      <p className="mt-4 text-2xl font-semibold tabular-nums tracking-tight text-neutral-900">
        {format(data.amount_minor, data.currency)}
      </p>
      <p className="mt-0.5 text-sm text-neutral-600">
        {data.description} · {t('expenses.claims.incurred', { date: formatDay(data.incurred_on) })}
      </p>

      <div className="mt-4">
        {data.receipt ? (
          <ReceiptPreview receipt={data.receipt} />
        ) : (
          <p className="well rounded-card px-4 py-6 text-center text-xs text-neutral-500">
            {t('expenses.claims.noReceipt')}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-danger-600">
          {error}
        </p>
      )}

      {data.state === 'submitted' ? (
        own ? (
          <p className="mt-4 text-xs text-neutral-500">{t('expenses.claims.ownClaim')}</p>
        ) : (
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRefusing(true)}
              className="btn btn-danger-ghost"
            >
              {t('expenses.claims.refuse')}
            </button>
            <button
              type="button"
              onClick={onApprove}
              disabled={approve.isPending}
              className="btn btn-primary"
            >
              <Icon name="check" size={15} />
              {approve.isPending ? t('expenses.claims.approving') : t('expenses.claims.approve')}
            </button>
          </div>
        )
      ) : (
        data.decided_by &&
        data.decided_at && (
          <p className="mt-4 text-xs text-neutral-600">
            {data.state === 'approved'
              ? [
                  t('expenses.claims.approvedBy', {
                    name: data.decided_by.full_name,
                    date: onDay(data.decided_at),
                  }),
                  data.reimbursed_at
                    ? t('expenses.claims.reimbursedOn', { date: onDay(data.reimbursed_at) })
                    : data.settlement
                      ? t('expenses.claims.awaitingIn', { where: settlementName(data.settlement) })
                      : t('expenses.claims.awaitingNowhere'),
                ].join(' ')
              : t('expenses.claims.refusedBy', {
                  name: data.decided_by.full_name,
                  date: onDay(data.decided_at),
                  reason: data.refusal_reason ?? '',
                })}
          </p>
        )
      )}

      {refusing && <RefuseDialog claim={data} onClose={() => setRefusing(false)} />}
    </aside>
  )
}

/**
 * Refusing a claim: never without a reason, which its submitter sees.
 *
 * Portalled to the body: it is opened from the claim panel, whose glass
 * (a backdrop filter) would otherwise be what `fixed` is fixed to.
 */
function RefuseDialog({ claim, onClose }: { claim: ClaimRead; onClose: () => void }) {
  const { t } = useTranslation(['finance', 'common'])
  const { format } = useCurrencies()
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const queryClient = useQueryClient()
  const refuse = useRefuseExpenseFinanceExpensesExpenseIdRefusePost()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!reason.trim()) return
    setError(null)
    try {
      await refuse.mutateAsync({ expenseId: claim.id, data: { reason: reason.trim() } })
      await queryClient.invalidateQueries({ predicate: isExpenseQuery })
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('expenses.claims.error')))
    }
  }

  return createPortal(
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
          {t('expenses.refuse.title', { name: claim.submitter.full_name })}
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          {claim.description} · {format(claim.amount_minor, claim.currency)} ·{' '}
          {formatDay(claim.incurred_on)}
        </p>
        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            {t('expenses.refuse.reason')}
          </span>
          <textarea
            autoFocus
            required
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="field resize-none"
          />
        </label>
        <p className="mt-1 text-xs text-neutral-400">
          {t('expenses.refuse.hint', { name: claim.submitter.full_name })}
        </p>
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
            type="submit"
            disabled={!reason.trim() || refuse.isPending}
            className="btn btn-danger"
          >
            {refuse.isPending ? t('expenses.refuse.submitting') : t('expenses.refuse.submit')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
