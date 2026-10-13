import { parseISO } from 'date-fns'
import { useState } from 'react'

import type { PayrollMonth } from '@/api/generated/models'
import { costSeries, formatMoneyShort, lastValueAt, niceCeiling } from '@/finance/reportSeries'
import { useCurrencies } from '@/finance/useCurrencies'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { Figure, Key, Tooltip } from '@/reports/Chart'
import { PAD, useChartWidth } from '@/reports/chartGeometry'
import { currencyInk, INK } from '@/reports/chartTokens'

const H = 150
/** Room on the left for "€12.5K". */
const P = { ...PAD, left: 44 }

/**
 * Payroll cost over time (#135): approved run totals per month, as small
 * multiples -- one chart per currency, each on its own scale, because a
 * total across currencies is a conversion nobody asked for.
 *
 * A month with no approved run is an outlined, empty slot: absent, which is
 * different from a month that cost nothing, and very different from a month
 * that cost what the one before it did.
 */
export function PayrollCostChart({
  months,
  currencies,
}: {
  months: PayrollMonth[]
  currencies: string[]
}) {
  const { t } = useTranslation('finance')
  return (
    <Figure
      title={t('reports.payroll.title')}
      note={t('reports.payroll.note')}
      empty={currencies.length === 0 ? t('reports.payroll.empty') : undefined}
      legend={
        months.some((month) => month.runs === 0) ? (
          <Key colour={INK.axis} label={t('reports.payroll.notApproved')} dashed />
        ) : undefined
      }
    >
      <div className="grid gap-x-6 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
        {currencies.map((currency, i) => (
          <CurrencyBars key={currency} months={months} currency={currency} ink={currencyInk(i)} />
        ))}
      </div>
    </Figure>
  )
}

function CurrencyBars({
  months,
  currency,
  ink,
}: {
  months: PayrollMonth[]
  currency: string
  ink: string
}) {
  const { t } = useTranslation('finance')
  const { format, placesOf } = useCurrencies()
  const [hovered, setHovered] = useState<number | null>(null)
  const { ref, width: W } = useChartWidth(320)
  const values = costSeries(months, currency)
  const short = (minor: number) => formatMoneyShort(minor, currency, placesOf(currency))
  const label = (i: number, pattern: string) => formatDate(parseISO(months[i].month), pattern)

  const top = niceCeiling(Math.max(0, ...values.map((value) => value ?? 0)))
  const inner = W - P.left - P.right
  const plot = H - P.top - P.bottom
  const slot = inner / Math.max(months.length, 1)
  const width = Math.min(slot * 0.68, 26)
  const y = (value: number) => P.top + plot * (1 - value / top)
  const centre = (i: number) => P.left + slot * i + slot / 2
  // The latest month anything was paid in this currency: named above the
  // chart, and the one bar drawn at full strength.
  const latest = lastValueAt(values.map((value) => value || null))
  // Thinned from the right, so the latest month always has its label.
  const every = Math.max(1, Math.ceil(months.length / Math.floor(inner / 30)))
  const shown = hovered === null ? null : months[hovered]
  const cost = shown?.costs.find((entry) => entry.currency === currency)
  // What an empty month is, in words: the tooltip's and the table's.
  const absent = (month: PayrollMonth) =>
    month.draft_runs > 0
      ? t('reports.payroll.draft', { count: month.draft_runs })
      : t('reports.payroll.noRun')

  return (
    <div>
      <p className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-semibold text-neutral-800">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: ink }} />
          <span className="identifier">{currency}</span>
        </span>
        {latest >= 0 && (
          <span className="text-neutral-500">
            {t('reports.payroll.latest', {
              amount: short(values[latest]!),
              month: label(latest, 'MMM'),
            })}
          </span>
        )}
      </p>
      <div ref={ref} className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={t('reports.payroll.chart', { currency })}
          onMouseLeave={() => setHovered(null)}
        >
          {[0, 0.5, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1={P.left}
                x2={W - P.right}
                y1={y(top * fraction)}
                y2={y(top * fraction)}
                stroke={INK.grid}
                strokeWidth={1}
              />
              <text
                x={P.left - 6}
                y={y(top * fraction) + 3}
                textAnchor="end"
                className="fill-neutral-400"
                style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
              >
                {short(top * fraction)}
              </text>
            </g>
          ))}
          {months.map((month, i) => {
            const value = values[i]
            return (
              <g key={month.month} onMouseEnter={() => setHovered(i)}>
                {/* Full-slot hit target, bigger than the mark. */}
                <rect
                  x={P.left + slot * i}
                  y={P.top}
                  width={slot}
                  height={plot}
                  fill="transparent"
                />
                {value === null ? (
                  <rect
                    data-testid="absent-month"
                    x={centre(i) - width / 2}
                    y={P.top + 1}
                    width={width}
                    height={plot - 1}
                    rx={4}
                    fill="none"
                    stroke={INK.axis}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                ) : (
                  value > 0 && (
                    <rect
                      x={centre(i) - width / 2}
                      y={y(value)}
                      width={width}
                      height={P.top + plot - y(value)}
                      rx={3}
                      fill={ink}
                      opacity={i === latest || i === hovered ? 1 : 0.72}
                    />
                  )
                )}
                {(months.length - 1 - i) % every === 0 && (
                  <text
                    x={centre(i)}
                    y={H - P.bottom + 14}
                    textAnchor="middle"
                    className="fill-neutral-400"
                    style={{ fontSize: 10 }}
                  >
                    {label(i, 'MMM')}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        {shown && (
          <Tooltip
            x={centre(hovered!)}
            width={W}
            title={label(hovered!, 'MMMM yyyy')}
            rows={
              shown.runs === 0
                ? [{ label: absent(shown), value: '' }]
                : [
                    {
                      colour: ink,
                      label: t('reports.payroll.amount'),
                      value: format(cost?.amount_minor ?? 0, currency),
                    },
                    { label: t('reports.payroll.people'), value: String(cost?.people ?? 0) },
                    { label: t('reports.payroll.runs'), value: String(shown.runs) },
                  ]
            }
          />
        )}
      </div>
      {/* The numbers as text, for anybody the bars do not reach. */}
      <table className="sr-only">
        <caption>{t('reports.payroll.table', { currency })}</caption>
        <tbody>
          {months.map((month, i) => (
            <tr key={month.month}>
              <th scope="row">{label(i, 'MMMM yyyy')}</th>
              <td>{values[i] === null ? absent(month) : format(values[i]!, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
