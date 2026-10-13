import { parseISO } from 'date-fns'

import type { PayrollMonth } from '@/api/generated/models'
import {
  costSeries,
  formatGrowth,
  formatMoneyShort,
  headcountSeries,
  indexed,
  lastValueAt,
  niceCeiling,
} from '@/finance/reportSeries'
import { useCurrencies } from '@/finance/useCurrencies'
import { useTranslation } from '@/i18n'
import { formatDate, formatNumber } from '@/i18n/format'
import { Figure, Key, Tooltip } from '@/reports/Chart'
import { PAD, useChartWidth, useCrosshair } from '@/reports/chartGeometry'
import { COUNT_INK, currencyInk, INK } from '@/reports/chartTokens'

const H = 240
/** Room on the right for "Headcount +20%" where a line ends. */
const P = { ...PAD, right: 104 }
/** How far apart two end labels have to be to be read. */
const LABEL_GAP = 13
/** Room a month label needs. */
const LABEL_WIDTH = 40

type Series = {
  key: string
  label: string
  ink: string
  dashed: boolean
  raw: (number | null)[]
  values: (number | null)[]
}

/**
 * Headcount and cost (#135): the people paid, and each currency's payroll,
 * indexed to where each line starts -- the chart that says "we grew 20% and
 * payroll grew 30%" without a spreadsheet, and without converting anything:
 * every line is compared with its own first month, not with the others.
 *
 * A month with no approved run breaks every line rather than bridging it.
 */
export function HeadcountChart({
  months,
  currencies,
}: {
  months: PayrollMonth[]
  currencies: string[]
}) {
  const { t } = useTranslation('finance')
  const { placesOf } = useCurrencies()
  const { ref, width: W } = useChartWidth(640)
  const { index, onMove, onLeave } = useCrosshair(months.length, P)

  const series: Series[] = [
    {
      key: 'headcount',
      label: t('reports.headcount.people'),
      ink: COUNT_INK,
      dashed: true,
      raw: headcountSeries(months),
    },
    ...currencies.map((currency, i) => ({
      key: currency,
      label: currency,
      ink: currencyInk(i),
      dashed: false,
      raw: costSeries(months, currency),
    })),
  ].map((entry) => ({ ...entry, values: indexed(entry.raw) }))

  const all = series.flatMap((entry) => entry.values.filter((value) => value !== null))
  const low = Math.min(100, ...all)
  const high = Math.max(100, ...all)
  const step = niceCeiling(Math.max(high - low, 20) / 4)
  const bottom = Math.floor(low / step) * step
  const top = Math.max(Math.ceil(high / step) * step, bottom + step)
  const ticks = Array.from(
    { length: Math.round((top - bottom) / step) + 1 },
    (_, i) => bottom + i * step,
  )

  const inner = W - P.left - P.right
  const plot = H - P.top - P.bottom
  const x = (i: number) =>
    P.left + (months.length === 1 ? inner / 2 : (inner * i) / (months.length - 1))
  const y = (value: number) => P.top + plot * (1 - (value - bottom) / (top - bottom))
  const month = (i: number, pattern: string) => formatDate(parseISO(months[i].month), pattern)
  // Thinned from the right, so the latest month always has its label.
  const labelEvery = Math.max(1, Math.ceil(months.length / Math.floor(inner / LABEL_WIDTH)))

  // Where each line ends, and its label there, nudged apart so none overlap.
  const ends = series
    .map((entry) => ({ entry, at: lastValueAt(entry.values) }))
    .filter(({ at }) => at >= 0)
    .map(({ entry, at }) => ({ entry, at, y: y(entry.values[at]!) }))
    .sort((a, b) => a.y - b.y)
  ends.forEach((end, i) => {
    if (i > 0) end.y = Math.max(end.y, ends[i - 1].y + LABEL_GAP)
  })
  // And lifted back up from the bottom, never into the month labels.
  for (let i = ends.length - 1; i >= 0; i -= 1) {
    const floor = i === ends.length - 1 ? H - P.bottom - 2 : ends[i + 1].y - LABEL_GAP
    ends[i].y = Math.min(ends[i].y, floor)
  }

  const hovered = index === null ? null : months[index]
  // "€10.6K · +104%": the amount, and how far it has come since the line
  // started, as the end labels say it. Before a line starts, the amount alone.
  const reading = (entry: Series, i: number) => {
    const raw = entry.raw[i] ?? 0
    const amount =
      entry.key === 'headcount'
        ? formatNumber(raw)
        : formatMoneyShort(raw, entry.key, placesOf(entry.key))
    const value = entry.values[i]
    return value === null
      ? amount
      : t('reports.headcount.reading', { amount, change: formatGrowth(value) })
  }

  return (
    <Figure
      title={t('reports.headcount.title')}
      note={t('reports.headcount.note')}
      empty={all.length === 0 ? t('reports.headcount.empty') : undefined}
      legend={series.map((entry) => (
        <Key key={entry.key} colour={entry.ink} label={entry.label} dashed={entry.dashed} />
      ))}
    >
      <div ref={ref} className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={t('reports.headcount.chart')}
          onMouseMove={(event) => onMove(event, W)}
          onMouseLeave={onLeave}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={P.left}
                x2={W - P.right}
                y1={y(tick)}
                y2={y(tick)}
                // Where every line starts: the one gridline worth finding.
                stroke={tick === 100 ? INK.reference : INK.grid}
                strokeWidth={1}
              />
              <text
                x={P.left - 6}
                y={y(tick) + 3}
                textAnchor="end"
                className="fill-neutral-400"
                style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
              >
                {tick}
              </text>
            </g>
          ))}

          {series.map((entry) => (
            <g key={entry.key}>
              <path
                d={path(entry.values, x, y)}
                fill="none"
                stroke={entry.ink}
                strokeWidth={2}
                strokeDasharray={entry.dashed ? '5 4' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* A month alone between gaps is a point, or it would not show. */}
              {entry.values.map((value, i) =>
                value !== null &&
                (entry.values[i - 1] ?? null) === null &&
                (entry.values[i + 1] ?? null) === null ? (
                  <circle key={i} cx={x(i)} cy={y(value)} r={2.5} fill={entry.ink} />
                ) : null,
              )}
            </g>
          ))}

          {ends.map(({ entry, at, y: labelY }) => (
            <g key={entry.key}>
              <circle cx={x(at)} cy={y(entry.values[at]!)} r={3} fill={entry.ink} />
              <text
                x={x(at) + 8}
                y={labelY + 3.5}
                className="fill-neutral-700"
                style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
              >
                {t('reports.headcount.ends', {
                  label: entry.label,
                  change: formatGrowth(entry.values[at]!),
                })}
              </text>
            </g>
          ))}

          {index !== null && (
            <line
              x1={x(index)}
              x2={x(index)}
              y1={P.top}
              y2={H - P.bottom}
              stroke={INK.axis}
              strokeWidth={1}
            />
          )}

          {months.map((_, i) =>
            (months.length - 1 - i) % labelEvery === 0 ? (
              <text
                key={i}
                x={x(i)}
                y={H - P.bottom + 14}
                textAnchor="middle"
                className="fill-neutral-400"
                style={{ fontSize: 10 }}
              >
                {month(i, 'MMM')}
              </text>
            ) : null,
          )}
        </svg>
        {hovered && (
          <Tooltip
            x={x(index!)}
            width={W}
            title={month(index!, 'MMMM yyyy')}
            rows={
              hovered.runs === 0
                ? [
                    {
                      label:
                        hovered.draft_runs > 0
                          ? t('reports.payroll.draft', { count: hovered.draft_runs })
                          : t('reports.payroll.noRun'),
                      value: '',
                    },
                  ]
                : series.map((entry) => ({
                    colour: entry.ink,
                    label: entry.label,
                    value: reading(entry, index!),
                  }))
            }
          />
        )}
      </div>
      {/* The lines as text, for anybody they do not reach. */}
      <table className="sr-only">
        <caption>{t('reports.headcount.table')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('reports.headcount.month')}</th>
            {series.map((entry) => (
              <th key={entry.key} scope="col">
                {entry.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((entry, i) => (
            <tr key={entry.month}>
              <th scope="row">{month(i, 'MMMM yyyy')}</th>
              {entry.runs === 0 ? (
                <td colSpan={series.length}>
                  {entry.draft_runs > 0
                    ? t('reports.payroll.draft', { count: entry.draft_runs })
                    : t('reports.payroll.noRun')}
                </td>
              ) : (
                series.map((line) => <td key={line.key}>{reading(line, i)}</td>)
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Figure>
  )
}

/** A line through the values, lifted over every gap rather than drawn across it. */
function path(
  values: (number | null)[],
  x: (i: number) => number,
  y: (value: number) => number,
): string {
  let pen = false
  return values
    .map((value, i) => {
      if (value === null) {
        pen = false
        return ''
      }
      const move = pen ? 'L' : 'M'
      pen = true
      return `${move}${x(i)},${y(value)}`
    })
    .join(' ')
    .trim()
}
