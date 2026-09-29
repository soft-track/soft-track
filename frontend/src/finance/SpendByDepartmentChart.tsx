import { keepPreviousData } from '@tanstack/react-query'
import clsx from 'clsx'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'

import { useGetBudgetOverviewFinanceBudgetsGet } from '@/api/generated/endpoints/budgets/budgets'
import type { BudgetRow } from '@/api/generated/models'
import { type Period, periodOf, periodShortLabel } from '@/finance/budgetPeriods'
import { byCurrency, formatMoneyShort, reportPeriods } from '@/finance/reportSeries'
import { useCurrencies } from '@/finance/useCurrencies'
import { useTranslation } from '@/i18n'
import { Figure } from '@/reports/Chart'
import { INK } from '@/reports/chartTokens'
import { Icon } from '@/ui/Icon'
import { Select } from '@/ui/Select'

/**
 * Spend by department (#135): payroll plus reimbursed expenses in a period,
 * against the budget set for exactly that period -- the Budgets page's own
 * numbers (#134), drawn, so the two never disagree.
 *
 * Grouped by currency, one scale each: a dollar bar beside a pound bar on
 * one axis would be a conversion at one to one. Over budget is said three
 * ways, so that no reader depends on telling red from green: the bar runs
 * past its tick, turns red, and says "over". The rows are HTML, like the
 * time-spent chart's, so names truncate like text and every number is text.
 */
export function SpendByDepartmentChart({ begins }: { begins: string }) {
  const { t } = useTranslation('finance')
  const [period, setPeriod] = useState<Period>(() => periodOf('quarter', new Date()))
  const overview = useGetBudgetOverviewFinanceBudgetsGet(
    { start: period.start, end: period.end },
    { query: { placeholderData: keepPreviousData } },
  )
  const options = reportPeriods(begins, new Date())
  const groups = byCurrency(overview.data?.rows ?? [])
  const label = periodShortLabel(period)

  return (
    <Figure
      title={t('reports.spend.title', { period: label })}
      note={t('reports.spend.note')}
      legend={
        <Select
          dense
          aria-label={t('reports.spend.period')}
          value={`${period.start}/${period.end}`}
          onChange={(e) => {
            const [start, end] = e.target.value.split('/')
            setPeriod({ start, end })
          }}
        >
          {(['quarter', 'month', 'year'] as const).map((granularity) => (
            <optgroup key={granularity} label={t(`reports.spend.${granularity}s`)}>
              {options[granularity].map((option) => (
                <option key={option.start} value={`${option.start}/${option.end}`}>
                  {periodShortLabel(option)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      }
    >
      {overview.isPending ? (
        <p className="py-10 text-center text-sm text-neutral-400">{t('reports.spend.loading')}</p>
      ) : groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-400">
          {t('reports.spend.empty', { period: label })}
        </p>
      ) : (
        // One grid for every row, the rows its subgrids: the amount column is
        // as wide as the widest amount, so every track is one length and a
        // bar's length means the same on every row. On a phone the bar takes
        // a line of its own, under the name and the amount.
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-4 sm:grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto]">
          {groups.map(([currency, rows]) => (
            <CurrencyGroup key={currency} currency={currency} rows={rows} />
          ))}
        </div>
      )}
      <Link
        to="/settings/finance/budgets"
        className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
      >
        {t('reports.spend.budgets')}
        <Icon name="chevron-right" size={12} />
      </Link>
    </Figure>
  )
}

function CurrencyGroup({ currency, rows }: { currency: string; rows: BudgetRow[] }) {
  const { t } = useTranslation('finance')
  const { format, placesOf } = useCurrencies()
  const headingId = useId()
  const short = (minor: number) => formatMoneyShort(minor, currency, placesOf(currency))
  // The group's own scale: its largest actual or budget fills the track.
  const top = Math.max(
    1,
    ...rows.flatMap((row) => [row.actual_minor, row.budget?.amount_minor ?? 0]),
  )
  const share = (minor: number) => `${(minor / top) * 100}%`

  return (
    <section aria-labelledby={headingId} className="col-span-full grid grid-cols-subgrid gap-y-2">
      <h4 id={headingId} className="eyebrow identifier col-span-full">
        {currency}
      </h4>
      <ul className="col-span-full grid grid-cols-subgrid gap-y-3 sm:gap-y-2">
        {rows.map((row) => {
          const budget = row.budget?.amount_minor ?? null
          const over = budget !== null && row.actual_minor > budget
          const name = row.department?.name ?? t('reports.spend.unattributed')
          return (
            <li
              key={row.department?.id ?? 'unattributed'}
              className="col-span-full grid grid-cols-subgrid items-center gap-y-1.5 text-xs"
            >
              <span
                className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 text-neutral-700"
                title={row.department ? name : t('reports.spend.unattributedHint')}
              >
                {!row.department && (
                  <Icon name="flag" size={11} className="shrink-0 text-accent-amber" />
                )}
                <span className={clsx('truncate', !row.department && 'font-medium')}>{name}</span>
              </span>
              <span
                className="relative col-span-full row-start-2 h-2.5 rounded-full bg-neutral-900/6 sm:col-span-1 sm:col-start-2 sm:row-start-1"
                aria-hidden="true"
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: share(row.actual_minor),
                    background: over ? 'var(--color-danger-500)' : INK.measure,
                  }}
                />
                {budget !== null && (
                  <span
                    data-testid="budget-tick"
                    className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-neutral-900"
                    style={{ left: share(budget) }}
                  />
                )}
              </span>
              <span className="col-start-2 row-start-1 flex items-center justify-end gap-1.5 sm:col-start-3">
                <span
                  className={clsx(
                    'identifier tabular-nums',
                    over ? 'font-semibold text-danger-600' : 'text-neutral-600',
                  )}
                  title={format(row.actual_minor, currency)}
                >
                  {budget === null
                    ? short(row.actual_minor)
                    : t('reports.spend.against', {
                        actual: short(row.actual_minor),
                        budget: short(budget),
                      })}
                </span>
                {over && (
                  <span
                    className="rounded bg-danger-50 px-1 py-px text-[10px] font-semibold text-danger-700"
                    title={t('reports.spend.overBy', {
                      amount: format(row.actual_minor - budget, currency),
                    })}
                  >
                    {t('reports.spend.over')}
                  </span>
                )}
                {budget === null && (
                  <span className="text-neutral-400">{t('reports.spend.noBudget')}</span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
