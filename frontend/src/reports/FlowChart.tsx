import { parseISO } from 'date-fns'

import type { CumulativeFlow, StatusCategory } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { CATEGORY_META } from '@/tickets/ticketMeta'
import { Figure, Key, Tooltip, XAxis, YAxis } from '@/reports/Chart'
import { PAD, useCrosshair } from '@/reports/chartGeometry'
import { FLOW_ORDER, FLOW_RAMP, INK } from '@/reports/chartTokens'

const W = 640
const H = 220

/**
 * Cumulative flow: how many tickets sat in each stage, each day.
 *
 * Stacked bottom-to-top in workflow order on a light-to-dark ramp, because
 * these bands are ordered stages rather than unrelated categories -- lightness
 * carries the progression. See chartTokens.ts for why the board's status
 * palette is not used here.
 */
export function FlowChart({
  data,
  limits = {},
}: {
  data: CumulativeFlow
  /**
   * A stage's WIP limit (#270): the sum of its statuses' limits, given only
   * where every status in the stage has one. Drawn as a line that far above
   * the band's lower edge, so the band crossing it is the stage going over.
   */
  limits?: Partial<Record<StatusCategory, number>>
}) {
  const { t } = useTranslation(['reports', 'common'])
  const days = data.days
  const { index, onMove, onLeave } = useCrosshair(days.length)

  const totals = days.map((day) =>
    FLOW_ORDER.reduce((sum, status) => sum + (day.counts[status as StatusCategory] ?? 0), 0),
  )
  // The bands below each stage, day by day: a stage's band starts there, and
  // so does its limit line.
  const belowOf = (order: number) =>
    days.map((day) =>
      FLOW_ORDER.slice(0, order).reduce(
        (sum, s) => sum + (day.counts[s as StatusCategory] ?? 0),
        0,
      ),
    )
  const limitLines = FLOW_ORDER.flatMap((status, order) => {
    const limit = limits[status as StatusCategory]
    if (limit == null) return []
    return [{ status, limit, values: belowOf(order).map((base) => base + limit) }]
  })
  const max = Math.max(1, ...totals, ...limitLines.flatMap((line) => line.values))
  const inner = W - PAD.left - PAD.right
  const plot = H - PAD.top - PAD.bottom

  const x = (i: number) =>
    PAD.left + (days.length === 1 ? inner / 2 : (inner * i) / (days.length - 1))
  const y = (value: number) => PAD.top + plot * (1 - value / max)

  // Bands are drawn as filled areas between running totals.
  const bands = FLOW_ORDER.map((status, order) => {
    const below = belowOf(order)
    const above = days.map(
      (day, i) => below[i] + (day.counts[status as StatusCategory] ?? 0),
    )
    const top = above.map((value, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(value)}`)
    // Back along the lower edge, right to left, to close the band.
    const bottom = below
      .map((_, i) => {
        const j = days.length - 1 - i
        return `L${x(j)},${y(below[j])}`
      })
      .slice(1)
    return { status, d: `${top.join(' ')} ${bottom.join(' ')} Z` }
  })

  const hovered = index !== null ? days[index] : null
  const allEmpty = totals.every((total) => total === 0)

  return (
    <Figure
      title={t('flow.title')}
      note={t('flow.note')}
      empty={allEmpty ? t('flow.empty') : undefined}
      legend={
        <>
          {FLOW_ORDER.map((status) => (
            <Key
              key={status}
              colour={FLOW_RAMP[status]}
              label={CATEGORY_META[status as StatusCategory].label}
            />
          ))}
        </>
      }
    >
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={t('flow.chart')}
          onMouseMove={(e) => onMove(e, W)}
          onMouseLeave={onLeave}
        >
          <YAxis max={max} width={W} height={H} />
          {bands.map((band) => (
            <path
              key={band.status}
              d={band.d}
              fill={FLOW_RAMP[band.status]}
              stroke="white"
              strokeWidth={2}
            />
          ))}
          {limitLines.map((line) => (
            <g key={`limit-${line.status}`}>
              <title>
                {t('flow.limitTitle', {
                  stage: CATEGORY_META[line.status as StatusCategory].label,
                  count: line.limit,
                })}
              </title>
              <path
                d={line.values.map((value, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(value)}`).join(' ')}
                fill="none"
                stroke={INK.axis}
                strokeWidth={1.5}
                strokeDasharray="5 4"
              />
              <text
                x={x(days.length - 1) - 4}
                y={y(line.values[line.values.length - 1]) - 5}
                textAnchor="end"
                fontSize={10}
                fill={INK.axis}
              >
                {t('flow.limit', { count: line.limit })}
              </text>
            </g>
          ))}
          {index !== null && (
            <line
              x1={x(index)}
              x2={x(index)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke={INK.axis}
              strokeWidth={1}
            />
          )}
          <XAxis
            labels={days.map((d) => formatDate(parseISO(d.day), 'd MMM'))}
            width={W}
            height={H}
          />
        </svg>

        {hovered && (
          <Tooltip
            x={x(index!)}
            width={W}
            title={formatDate(parseISO(hovered.day), 'EEE d MMM')}
            rows={FLOW_ORDER.filter(
              (status) => (hovered.counts[status as StatusCategory] ?? 0) > 0,
            ).map((status) => ({
              colour: FLOW_RAMP[status],
              label: CATEGORY_META[status as StatusCategory].label,
              value: String(hovered.counts[status as StatusCategory] ?? 0),
            }))}
          />
        )}
      </div>
    </Figure>
  )
}
