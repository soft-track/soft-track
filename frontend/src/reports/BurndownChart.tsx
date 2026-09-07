import { format, parseISO } from 'date-fns'

import type { Burndown } from '../api/generated/models'
import { Figure, Key, Tooltip, XAxis, YAxis } from './Chart'
import { PAD, useCrosshair } from './chartGeometry'
import { INK } from './chartTokens'

const W = 640
const H = 220

export function BurndownChart({ data }: { data: Burndown }) {
  const points = data.points
  const { index, onMove, onLeave } = useCrosshair(points.length)

  const max = Math.max(1, ...points.map((p) => Math.max(p.points_total, p.ideal_remaining)))
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
      title={`Burndown · ${data.cycle_name}`}
      note="Points still outstanding each day. The dashed line runs from the cycle's opening scope to zero — work added later does not move it."
      empty={points.length === 0 ? 'This cycle has not started yet.' : undefined}
      legend={
        <>
          <Key colour={INK.measure} label="Remaining" />
          <Key colour={INK.axis} label="Ideal" dashed />
          {data.scope_changes.length > 0 && (
            <Key colour={INK.contrastSeries} label="Scope changed" />
          )}
        </>
      }
    >
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`Burndown for ${data.cycle_name}`}
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
            d={path((p) => p.ideal_remaining)}
            fill="none"
            stroke={INK.axis}
            strokeWidth={2}
            strokeDasharray="4 4"
          />
          <path
            d={path((p) => p.points_remaining)}
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
                cy={y(points[points.length - 1].points_remaining)}
                r={4}
                fill={INK.measure}
                stroke="white"
                strokeWidth={2}
              />
              <text
                x={x(points.length - 1) - 8}
                y={y(points[points.length - 1].points_remaining) - 8}
                textAnchor="end"
                className="fill-neutral-700"
                style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
              >
                {points[points.length - 1].points_remaining} left
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
            labels={points.map((p) => format(parseISO(p.day), 'd MMM'))}
            width={W}
            height={H}
          />
        </svg>

        {hovered && (
          <Tooltip
            x={x(index!)}
            width={W}
            title={format(parseISO(hovered.day), 'EEE d MMM')}
            rows={[
              { colour: INK.measure, label: 'Remaining', value: `${hovered.points_remaining} pts` },
              { colour: INK.axis, label: 'Ideal', value: `${Math.round(hovered.ideal_remaining)} pts` },
              { label: 'Scope', value: `${hovered.points_total} pts` },
              { label: 'Issues left', value: `${hovered.issues_remaining}` },
            ]}
          />
        )}
      </div>
    </Figure>
  )
}
