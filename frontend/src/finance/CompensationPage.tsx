import { keepPreviousData } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useListCompensationFinanceCompensationGet } from '@/api/generated/endpoints/compensation/compensation'
import { useListDepartmentsDepartmentsGet } from '@/api/generated/endpoints/departments/departments'
import type { CompensationKind, CompensationRow, Currency } from '@/api/generated/models'
import { formatChange, formatDay } from '@/finance/money'
import { RecordPayDialog } from '@/finance/RecordPayDialog'
import { useCurrencies } from '@/finance/useCurrencies'
import { useTranslation } from '@/i18n'
import { useDebounced } from '@/search/useDebounced'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'

const PAGE_SIZE = 50

/**
 * Finance → Compensation (#131): what everybody active is paid today.
 *
 * The current figure is the latest record in effect; a raise dated ahead is
 * scheduled, and somebody with nothing in effect says so in red -- what a
 * payroll run would otherwise leave out without a word. Totals are per
 * currency and per schedule, and never anything more: there is no rate to add
 * euros to pounds, or a month to a fortnight.
 */
export default function CompensationPage() {
  const { t } = useTranslation(['finance', 'common'])
  const { currencies, format } = useCurrencies()
  const departments = useListDepartmentsDepartmentsGet()
  const [search, setSearch] = useState('')
  const q = useDebounced(search, 250).trim()
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  const [currency, setCurrency] = useState<Currency | null>(null)
  const [offset, setOffset] = useState(0)
  const [recording, setRecording] = useState(false)

  const page = useListCompensationFinanceCompensationGet(
    {
      q: q || undefined,
      department_id: departmentId ?? undefined,
      currency: currency ?? undefined,
      limit: PAGE_SIZE,
      offset,
    },
    { query: { placeholderData: keepPreviousData } },
  )
  const rows = page.data?.items ?? []
  const total = page.data?.total ?? 0

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
              {t('compensation.title')}
            </h1>
            <p className="mt-1 max-w-prose text-sm text-neutral-500">{t('compensation.intro')}</p>
          </div>
          <button type="button" onClick={() => setRecording(true)} className="btn btn-primary">
            <Icon name="plus" size={15} />
            {t('compensation.recordPay')}
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <label className="relative block w-full max-w-xs">
            <span className="sr-only">{t('compensation.searchLabel')}</span>
            <Icon
              name="search"
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setOffset(0)
              }}
              placeholder={t('compensation.searchPlaceholder')}
              className="field field-sm pl-8"
            />
          </label>
          <Select
            dense
            aria-label={t('compensation.departmentLabel')}
            value={departmentId ?? ''}
            onChange={(e) => {
              setDepartmentId(e.target.value ? Number(e.target.value) : null)
              setOffset(0)
            }}
          >
            <option value="">{t('compensation.anyDepartment')}</option>
            {(departments.data ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
          <Select
            dense
            aria-label={t('compensation.currencyLabel')}
            value={currency ?? ''}
            onChange={(e) => {
              setCurrency((e.target.value || null) as Currency | null)
              setOffset(0)
            }}
          >
            <option value="">{t('compensation.anyCurrency')}</option>
            {currencies.map((option) => (
              <option key={option.code} value={option.code}>
                {option.code}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <section className="glass-strong rounded-panel p-4 sm:p-6">
        {page.isPending ? (
          <Loading label={t('compensation.loading')} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-neutral-400">{t('compensation.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <CompensationTable rows={rows} format={format} />
          </div>
        )}

        {page.data && page.data.totals.length > 0 && (
          <div className="hairline mt-4 border-t pt-4">
            <p className="sr-only">{t('compensation.totalsLabel')}</p>
            <ul
              aria-label={t('compensation.totalsLabel')}
              className="flex flex-wrap items-center gap-2 text-xs text-neutral-500"
            >
              <li className="mr-1">{t('compensation.totals')}</li>
              {page.data.totals.map((sum) => (
                <li
                  key={`${sum.pay_schedule}-${sum.currency}`}
                  className="well flex items-center gap-1.5 rounded-full px-2.5 py-1"
                >
                  <span className="identifier text-[10px] font-semibold text-neutral-400">
                    {sum.currency}
                  </span>
                  <span className="font-semibold tabular-nums text-neutral-900">
                    {format(sum.amount_minor, sum.currency)}
                  </span>
                  <span>{t(`compensation.scheduleWord.${sum.pay_schedule}`)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-neutral-400">
              {t('compensation.totalsHint')}
              {page.data.missing > 0 && (
                <>
                  {' '}
                  <span className="text-danger-600">
                    {t('compensation.missing', { count: page.data.missing })}
                  </span>
                </>
              )}
            </p>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="hairline mt-4 flex items-center justify-between border-t pt-4">
            <p className="text-xs text-neutral-400">
              {t('compensation.showing', {
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
                {t('compensation.previous')}
              </button>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="btn btn-ghost btn-sm"
              >
                {t('compensation.next')}
                <Icon name="chevron-right" size={14} />
              </button>
            </div>
          </div>
        )}
      </section>

      {recording && <RecordPayDialog onClose={() => setRecording(false)} />}
    </div>
  )
}

function CompensationTable({
  rows,
  format,
}: {
  rows: CompensationRow[]
  format: (minor: number, currency: string) => string
}) {
  const { t } = useTranslation(['finance', 'common'])
  // On the cells rather than the rows: a separated table draws no row borders.
  const cell = 'hairline border-t px-3 py-2.5'
  return (
    <table className="w-full border-separate border-spacing-0 text-left text-sm">
      <thead>
        <tr className="eyebrow">
          <th scope="col" className="px-3 py-2 font-semibold">
            {t('compensation.columns.person')}
          </th>
          <th scope="col" className="px-3 py-2 text-right font-semibold">
            {t('compensation.columns.current')}
          </th>
          <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">
            {t('compensation.columns.schedule')}
          </th>
          <th scope="col" className="hidden px-3 py-2 font-semibold md:table-cell">
            {t('compensation.columns.since')}
          </th>
          <th scope="col" className="px-3 py-2 font-semibold">
            {t('compensation.columns.lastChange')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ person, current, scheduled, change_percent }) => (
          <tr key={person.id}>
            <td className={cell}>
              <div className="flex items-center gap-3">
                <Avatar user={person} size={30} decorative />
                <div className="min-w-0">
                  <Link
                    to={`/settings/finance/compensation/${person.username}`}
                    className="block truncate font-medium text-neutral-900 hover:underline"
                  >
                    {person.full_name}
                  </Link>
                  <p className="truncate text-xs text-neutral-400">
                    {person.department?.name ?? t('compensation.noDepartment')}
                  </p>
                </div>
              </div>
            </td>
            <td className={`${cell} text-right`}>
              {current ? (
                <span className="identifier font-medium text-neutral-900 tabular-nums">
                  {format(current.amount_minor, current.currency)}
                </span>
              ) : (
                <span className="text-neutral-400">{t('compensation.noRecord')}</span>
              )}
            </td>
            <td className={`${cell} hidden text-neutral-600 sm:table-cell`}>
              {current ? t(`compensation.schedules.${current.pay_schedule}`) : '—'}
            </td>
            <td className={`${cell} hidden text-neutral-600 md:table-cell`}>
              {current ? formatDay(current.effective_on) : '—'}
            </td>
            <td className={cell}>
              <div className="flex flex-wrap items-center gap-1.5 text-neutral-600">
                {current ? (
                  <LastChange kind={current.kind} change={change_percent} />
                ) : scheduled.length > 0 ? (
                  <span className="text-neutral-500">
                    {t('compensation.startsOn', { date: formatDay(scheduled[0].effective_on) })}
                  </span>
                ) : (
                  <span
                    className="chip"
                    style={{ ['--chip' as string]: 'var(--color-danger-500)' }}
                  >
                    {t('compensation.nothingRecorded')}
                  </span>
                )}
                {/* Somebody not started yet already reads "Starts …". */}
                {current && scheduled.length > 0 && (
                  <span
                    className="chip"
                    style={{ ['--chip' as string]: 'var(--color-accent-sky)' }}
                  >
                    {scheduled.length === 1
                      ? t(`compensation.scheduledOne.${scheduled[0].kind}`)
                      : t('compensation.scheduledMany', { count: scheduled.length })}
                  </span>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** "Raise, +4%", "Hired", "Correction". */
function LastChange({ kind, change }: { kind: CompensationKind; change?: number | null }) {
  const { t } = useTranslation('finance')
  if (change != null && kind === 'raise') {
    return <span>{t('compensation.lastChange.raiseBy', { change: formatChange(change) })}</span>
  }
  if (change != null && kind === 'other') {
    return <span>{t('compensation.lastChange.otherBy', { change: formatChange(change) })}</span>
  }
  return <span>{t(`compensation.lastChange.${kind}`)}</span>
}
