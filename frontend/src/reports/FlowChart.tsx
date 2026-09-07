import { format, parseISO } from 'date-fns'

import type { CumulativeFlow, IssueStatus } from '@/api/generated/models'
import { STATUS_META } from '@/issues/issueMeta'
import { Figure, Key, Tooltip, XAxis, YAxis } from '@/reports/Chart'
import { PAD, useCrosshair } from '@/reports/chartGeometry'
import { FLOW_ORDER, FLOW_RAMP, INK } from '@/reports/chartTokens'

const W = 640
const H = 220

/**
 * Cumulative flow: how many issues sat in each stage, each day.
 *
 * Stacked bottom-to-top in workflow order on a light-to-dark ramp, because
 * these bands are ordered stages rather than unrelated categories -- lightness
 * carries the progression. See chartTokens.ts for why the board's status
 * palette is not used here.
 */
export function FlowChart({ data }: { data: CumulativeFlow }) {
  const days = data.days
  const { index, onMove, onLeave } = useCrosshair(days.length)

  const totals = days.map((day) =>
    FLOW_ORDER.reduce((sum, status) => sum + (day.counts[status as IssueStatus] ?? 0), 0),
  )
  const max = Math.max(1, ...totals)
  const inner = W - PAD.left - PAD.right
  const plot = H - PAD.top - PAD.bottom

  const x = (i: number) =>
    PAD.left + (days.length === 1 ? inner / 2 : (inner * i) / (days.length - 1))
  const y = (value: number) => PAD.top + plot * (1 - value / max)

  // Bands are drawn as filled areas between running totals.
  const bands = FLOW_ORDER.map((status, order) => {
    const below = days.map((day) =>
      FLOW_ORDER.slice(0, order).reduce(
        (sum, s) => sum + (day.counts[s as IssueStatus] ?? 0),
        0,
      ),
    )
    const above = days.map(
      (day, i) => below[i] + (day.counts[status as IssueStatus] ?? 0),
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
      title="Cumulative flow"
      note="Issues in each stage, per day. A band that keeps widening is work piling up in that stage."
      empty={allEmpty ? 'No issue history in this window yet.' : undefined}
      legend={
        <>
          {FLOW_ORDER.map((status) => (
            <Key
              key={status}
              colour={FLOW_RAMP[status]}
              label={STATUS_META[status as IssueStatus].label}
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
          aria-label="Cumulative flow diagram"
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
            labels={days.map((d) => format(parseISO(d.day), 'd MMM'))}
            width={W}
            height={H}
          />
        </svg>

        {hovered && (
          <Tooltip
            x={x(index!)}
            width={W}
            title={format(parseISO(hovered.day), 'EEE d MMM')}
            rows={FLOW_ORDER.filter(
              (status) => (hovered.counts[status as IssueStatus] ?? 0) > 0,
            ).map((status) => ({
              colour: FLOW_RAMP[status],
              label: STATUS_META[status as IssueStatus].label,
              value: String(hovered.counts[status as IssueStatus] ?? 0),
            }))}
          />
        )}
      </div>
    </Figure>
  )
}
