import { parseISO } from 'date-fns'

import type { Burndown } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { Figure, Key, Tooltip, XAxis, YAxis } from '@/reports/Chart'
import { PAD, useCrosshair } from '@/reports/chartGeometry'
import { INK } from '@/reports/chartTokens'
import { formatDuration } from '@/tickets/duration'

const W = 640
const H = 220

type Point = Burndown['points'][number]

/** What the chart draws, in points or -- for a team estimating in hours (#268) -- in hours. */
const MEASURES = {
  points: {
    remaining: (p: Point) => p.points_remaining,
    ideal: (p: Point) => p.ideal_remaining,
    total: (p: Point) => p.points_total,
  },
  hours: {
    remaining: (p: Point) => p.minutes_remaining / 60,
    ideal: (p: Point) => p.ideal_minutes_remaining / 60,
    total: (p: Point) => p.minutes_total / 60,
  },
} as const

export function BurndownChart({
  data,
  unit = 'points',
}: {
  data: Burndown
  /** Points, or remaining hours for a team that estimates in them (#268). */
  unit?: 'points' | 'hours'
}) {
  const { t } = useTranslation(['reports', 'common'])
  const points = data.points
  const { index, onMove, onLeave } = useCrosshair(points.length)
  const measure = MEASURES[unit]
  // A value as the chart says it: "8 pts", or "3h 30m".
  const say = (value: number) =>
    unit === 'hours'
      ? formatDuration(Math.round(value * 60))
      : t('burndown.points', { points: Math.round(value) })

  const max = Math.max(1, ...points.map((p) => Math.max(measure.total(p), measure.ideal(p))))
  const inner = W - PAD.left - PAD.right
  const plot = H - PAD.top - PAD.bottom

  const x = (i: number) =>
    PAD.left + (points.length === 1 ? inner / 2 : (inner * i) / (points.length - 1))
  const y = (value: number) => PAD.top + plot * (1 - value / max)

  const path = (pick: (p: (typeof points)[number]) => number) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(pick(p))}`).join(' ')

  const scopeDays = new Set(data.scope_changes.map((change) => change.day))
  const hovered = index !== null ? points[index] : null

  return (
    <Figure
      title={t('burndown.title', { sprint: data.sprint_name })}
      note={unit === 'hours' ? t('burndown.noteHours') : t('burndown.note')}
      empty={points.length === 0 ? t('burndown.notStarted') : undefined}
      legend={
        <>
          <Key colour={INK.measure} label={t('burndown.remaining')} />
          <Key colour={INK.axis} label={t('burndown.ideal')} dashed />
          {data.scope_changes.length > 0 && (
            <Key colour={INK.contrastSeries} label={t('burndown.scopeChanged')} />
          )}
        </>
      }
    >
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={t('burndown.chart', { sprint: data.sprint_name })}
          onMouseMove={(e) => onMove(e, W)}
          onMouseLeave={onLeave}
        >
          <YAxis max={max} width={W} height={H} />

          {/* Days scope moved, marked behind the lines: a burndown that hides
              them makes a team look slow when the sprint actually grew. */}
          {points.map((point, i) =>
            scopeDays.has(point.day) ? (
              <line
                key={point.day}
                x1={x(i)}
                x2={x(i)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke={INK.contrastSeries}
                strokeWidth={2}
                strokeOpacity={0.35}
              />
            ) : null,
          )}

          <path
            d={path(measure.ideal)}
            fill="none"
            stroke={INK.axis}
            strokeWidth={2}
            strokeDasharray="4 4"
          />
          <path
            d={path(measure.remaining)}
            fill="none"
            stroke={INK.measure}
            strokeWidth={2}
            strokeLinejoin="round"
          />

          {/* The last point is labelled directly rather than every point. */}
          {points.length > 0 && (
            <>
              <circle
                cx={x(points.length - 1)}
                cy={y(measure.remaining(points[points.length - 1]))}
                r={4}
                fill={INK.measure}
                stroke="white"
                strokeWidth={2}
              />
              <text
                x={x(points.length - 1) - 8}
                y={y(measure.remaining(points[points.length - 1])) - 8}
                textAnchor="end"
                className="fill-neutral-700"
                style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
              >
                {t('burndown.left', {
                  points:
                    unit === 'hours'
                      ? formatDuration(points[points.length - 1].minutes_remaining)
                      : points[points.length - 1].points_remaining,
                })}
              </text>
            </>
          )}

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
            labels={points.map((p) => formatDate(parseISO(p.day), 'd MMM'))}
            width={W}
            height={H}
          />
        </svg>

        {hovered && (
          <Tooltip
            x={x(index!)}
            width={W}
            title={formatDate(parseISO(hovered.day), 'EEE d MMM')}
            rows={[
              {
                colour: INK.measure,
                label: t('burndown.remaining'),
                value: say(measure.remaining(hovered)),
              },
              {
                colour: INK.axis,
                label: t('burndown.ideal'),
                value: say(measure.ideal(hovered)),
              },
              {
                label: t('burndown.scope'),
                value: say(measure.total(hovered)),
              },
              { label: t('burndown.ticketsLeft'), value: `${hovered.tickets_remaining}` },
            ]}
          />
        )}
      </div>
    </Figure>
  )
}
