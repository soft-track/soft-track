import { keepPreviousData } from '@tanstack/react-query'
import { parseISO } from 'date-fns'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useGetPayrollReportFinanceReportsPayrollGet } from '@/api/generated/endpoints/finance-reports/finance-reports'
import { HeadcountChart } from '@/finance/HeadcountChart'
import { PayrollCostChart } from '@/finance/PayrollCostChart'
import { reportCurrencies } from '@/finance/reportSeries'
import { SpendByDepartmentChart } from '@/finance/SpendByDepartmentChart'
import { Trans, userText, useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

/** Months to look back; null is everything since the reports begin. */
const WINDOWS = [6, 12, null] as const

/**
 * Finance → Reports (#135): payroll cost, spend by department, and
 * headcount against cost.
 *
 * The same rules as the issue reports, because they apply word for word:
 * built from real rows, never run into the future, and begin where the data
 * begins -- and say so, because a chart that quietly starts late looks like
 * a chart of a cheap year.
 */
export default function FinanceReportsPage() {
  const { t } = useTranslation(['finance', 'common'])
  const [back, setBack] = useState<(typeof WINDOWS)[number]>(12)
  const report = useGetPayrollReportFinanceReportsPayrollGet(
    back === null ? undefined : { months: back },
    { query: { placeholderData: keepPreviousData } },
  )
  const months = report.data?.months ?? []
  const currencies = reportCurrencies(months)
  const begins = report.data?.begins_on ?? null

  return (
    <div className="space-y-4">
      <div className="glass-strong sheen rounded-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
              {t('reports.title')}
            </h1>
            <p className="mt-1 max-w-prose text-sm text-neutral-500">{t('reports.intro')}</p>
          </div>
          <div className="segmented" role="group" aria-label={t('reports.window.label')}>
            {WINDOWS.map((option) => (
              <button
                key={option ?? 'all'}
                type="button"
                aria-pressed={back === option}
                data-active={back === option}
                onClick={() => setBack(option)}
                className="segmented-item"
              >
                {option === null
                  ? t('reports.window.all')
                  : t('reports.window.months', { count: option })}
              </button>
            ))}
          </div>
        </div>

        {report.data && (
          <p
            role="note"
            className="mt-4 flex items-start gap-2 rounded-control bg-neutral-900/5 px-3 py-2 text-sm text-neutral-600"
          >
            <Icon name="history" size={15} className="mt-0.5 shrink-0 text-neutral-400" />
            <span>
              {begins ? (
                <Trans
                  t={t}
                  i18nKey="reports.begins"
                  values={{ month: formatDate(parseISO(begins), 'MMMM yyyy') }}
                  components={{ strong: <strong className="font-semibold text-neutral-800" /> }}
                  {...userText}
                />
              ) : (
                <Trans
                  t={t}
                  i18nKey="reports.none"
                  components={{
                    runs: (
                      <Link
                        to="/settings/finance/payroll"
                        className="font-medium text-brand-600 hover:underline"
                      />
                    ),
                  }}
                />
              )}
            </span>
          </p>
        )}
      </div>

      {report.isPending ? (
        <Loading label={t('reports.loading')} />
      ) : report.isError && !report.data ? (
        <p role="alert" className="glass rounded-panel p-4 text-sm text-danger-600">
          {t('reports.error')}
        </p>
      ) : (
        begins && (
          <>
            <PayrollCostChart months={months} currencies={currencies} />
            <div className="grid gap-4 xl:grid-cols-2">
              <SpendByDepartmentChart begins={begins} />
              <HeadcountChart months={months} currencies={currencies} />
            </div>
          </>
        )
      )}
    </div>
  )
}
