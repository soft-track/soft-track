import { parseISO } from 'date-fns'
import { useState } from 'react'

import type { ProjectBurnup, ProjectBurnupPoint } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
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
  const { t } = useTranslation(['reports', 'common'])
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
  const value = (count: number) =>
    unit === 'issues'
      ? t('burnup.value.issues', { count })
      : t('burnup.value.points', { value: count })
  // The label on the latest day: a `+` says the points scope is only a floor.
  const latestLabel = (point: ProjectBurnupPoint) => {
    const counts = { done: read(point, series.done), scope: read(point, series.scope) }
    if (unit === 'issues') {
      return t('burnup.latest.issues', { done: counts.done, count: counts.scope })
    }
    return point.unestimated_issues > 0
      ? t('burnup.latest.pointsFloor', counts)
      : t('burnup.latest.points', counts)
  }

  return (
    <Figure
      title={t('burnup.title')}
      note={
        data.started_on
          ? t('burnup.note', { date: formatDate(parseISO(data.started_on), 'd MMM yyyy') })
          : undefined
      }
      empty={points.length === 0 ? t('burnup.empty') : undefined}
      legend={
        <>
          <Key colour={INK.contrastSeries} label={t('burnup.scope')} />
          <Key colour={INK.measure} label={t('burnup.completed')} />
          <div className="segmented ml-auto" role="tablist" aria-label={t('burnup.measure')}>
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
                {option === 'issues' ? t('burnup.issues') : t('burnup.points')}
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
          aria-label={
            unit === 'issues'
              ? t('burnup.chart.issues', { project: data.project_name })
              : t('burnup.chart.points', { project: data.project_name })
          }
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
              {latestLabel(latest)}
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
                colour: INK.contrastSeries,
                label: t('burnup.scope'),
                value: value(read(hovered, series.scope)),
              },
              {
                colour: INK.measure,
                label: t('burnup.completed'),
                value: value(read(hovered, series.done)),
              },
              ...(hovered.unestimated_issues > 0
                ? [{ label: t('burnup.unestimated'), value: `${hovered.unestimated_issues}` }]
                : []),
            ]}
          />
        )}
      </div>
    </Figure>
  )
}
