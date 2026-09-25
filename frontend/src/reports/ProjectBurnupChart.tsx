import { format, parseISO } from 'date-fns'
import { useState } from 'react'

import type { ProjectBurnup, ProjectBurnupPoint } from '@/api/generated/models'
import { unestimatedNote } from '@/reports/burnup'
import { Figure, Key, Tooltip, XAxis, YAxis } from '@/reports/Chart'
import { PAD, useCrosshair } from '@/reports/chartGeometry'
import { INK } from '@/reports/chartTokens'

const W = 640
const H = 220

type Unit = 'issues' | 'points'
/** The per-day counts: every field of a point but its day. */
type Count = Exclude<keyof ProjectBurnupPoint, 'day'>

const SERIES: Record<Unit, { scope: Count; done: Count }> = {
  issues: { scope: 'scope_issues', done: 'completed_issues' },
  points: { scope: 'scope_points', done: 'completed_points' },
}

/**
 * A project's scope against its completed work, day by day (issue #64).
 *
 * A burnup rather than a burndown: an epic's scope is expected to move, and
 * a rising top line is scope added after work started -- the thing a
 * burndown folds into "remaining" and hides.
 */
export function ProjectBurnupChart({ data }: { data: ProjectBurnup }) {
  const [unit, setUnit] = useState<Unit>('issues')
  const points = data.points
  const { index, onMove, onLeave } = useCrosshair(points.length)
  const series = SERIES[unit]
  const read = (point: ProjectBurnupPoint, key: Count) => point[key]

  const max = Math.max(1, ...points.map((p) => read(p, series.scope)))
  const inner = W - PAD.left - PAD.right
  const plot = H - PAD.top - PAD.bottom
  const x = (i: number) =>
    PAD.left + (points.length === 1 ? inner / 2 : (inner * i) / (points.length - 1))
  const y = (value: number) => PAD.top + plot * (1 - value / max)
  const path = (key: Count) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(read(p, key))}`).join(' ')

  const latest = points[points.length - 1]
  const floor = unit === 'points' ? unestimatedNote(latest) : null
  const hovered = index !== null ? points[index] : null
  const label = unit === 'issues' ? 'issues' : 'pts'

  return (
    <Figure
      title="Burnup"
      note={
        data.started_on
          ? `Scope against completed work since ${format(parseISO(data.started_on), 'd MMM yyyy')}, the first day history records anything about this project. Cancelled issues count as neither.`
          : undefined
      }
      empty={
        points.length === 0
          ? 'No history for this project yet. The chart starts on the first day an issue is moved into it or out of it.'
          : undefined
      }
      legend={
        <>
          <Key colour={INK.contrastSeries} label="Scope" />
          <Key colour={INK.measure} label="Completed" />
          <div className="segmented ml-auto" role="tablist" aria-label="Measure">
            {(['issues', 'points'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={unit === option}
                data-active={unit === option}
                onClick={() => setUnit(option)}
                className="segmented-item"
              >
                {option === 'issues' ? 'Issues' : 'Points'}
              </button>
            ))}
          </div>
        </>
      }
    >
      {floor && (
        <p
          role="note"
          className="mb-2 rounded-control bg-neutral-900/5 px-2.5 py-1.5 text-xs text-neutral-600"
        >
          {floor}
        </p>
      )}
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`Burnup for ${data.project_name}, in ${unit}`}
          onMouseMove={(e) => onMove(e, W)}
          onMouseLeave={onLeave}
        >
          <YAxis max={max} width={W} height={H} />
          <path
            d={path(series.scope)}
            fill="none"
            stroke={INK.contrastSeries}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <path
            d={path(series.done)}
            fill="none"
            stroke={INK.measure}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          {latest && (
            <text
              x={x(points.length - 1) - 8}
              y={y(read(latest, series.scope)) - 8}
              textAnchor="end"
              className="fill-neutral-700"
              style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
            >
              {read(latest, series.done)} of {read(latest, series.scope)}
              {unit === 'points' && latest.unestimated_issues > 0 ? '+' : ''} {label}
            </text>
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
              {
                colour: INK.contrastSeries,
                label: 'Scope',
                value: `${read(hovered, series.scope)} ${label}`,
              },
              {
                colour: INK.measure,
                label: 'Completed',
                value: `${read(hovered, series.done)} ${label}`,
              },
              ...(hovered.unestimated_issues > 0
                ? [{ label: 'Unestimated', value: `${hovered.unestimated_issues}` }]
                : []),
            ]}
          />
        )}
      </div>
    </Figure>
  )
}
