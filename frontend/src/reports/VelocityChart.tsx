import { useState } from 'react'

import type { Velocity } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { Figure, Key } from '@/reports/Chart'
import { PAD } from '@/reports/chartGeometry'
import { INK } from '@/reports/chartTokens'

const W = 640
const H = 220

/**
 * Committed against completed, per sprint.
 *
 * Target-and-actual rather than two equal bars: the pale bar is what the team
 * signed up for, the solid one is what landed. Every bar carries its number,
 * which is also what discharges the contrast warning on a pale fill.
 */
export function VelocityChart({ data }: { data: Velocity }) {
  const { t } = useTranslation(['reports', 'common'])
  const [hovered, setHovered] = useState<number | null>(null)
  const sprints = data.sprints

  const max = Math.max(1, ...sprints.flatMap((c) => [c.points_committed, c.points_completed]))
  const inner = W - PAD.left - PAD.right
  const plot = H - PAD.top - PAD.bottom
  const slot = inner / Math.max(sprints.length, 1)
  const wide = Math.min(slot * 0.62, 56)
  const narrow = wide * 0.55

  const y = (value: number) => PAD.top + plot * (1 - value / max)
  const barX = (i: number, width: number) => PAD.left + slot * i + (slot - width) / 2

  const averageY = data.average_points != null ? y(data.average_points) : null

  return (
    <Figure
      title={t('velocity.title')}
      note={t('velocity.note')}
      empty={sprints.length === 0 ? t('velocity.empty') : undefined}
      legend={
        <>
          <Key colour={INK.reference} label={t('velocity.committed')} />
          <Key colour={INK.measure} label={t('velocity.completed')} />
          {data.average_points != null && (
            <Key
              colour={INK.contrastSeries}
              label={t('velocity.average', { points: data.average_points })}
              dashed
            />
          )}
        </>
      }
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={t('velocity.chart')}
      >
        {[0, 0.5, 1].map((fraction) => (
          <line
            key={fraction}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(max * fraction)}
            y2={y(max * fraction)}
            stroke={INK.grid}
            strokeWidth={1}
          />
        ))}

        {sprints.map((sprint, i) => {
          const active = hovered === i
          return (
            <g
              key={sprint.sprint_id}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Full-slot hit target, bigger than the marks. */}
              <rect
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={plot}
                fill="transparent"
              />
              <rect
                x={barX(i, wide)}
                y={y(sprint.points_committed)}
                width={wide}
                height={Math.max(plot - (y(sprint.points_committed) - PAD.top), 0)}
                rx={4}
                fill={INK.reference}
              />
              {/* A 2px surface ring keeps the two fills from touching. */}
              <rect
                x={barX(i, narrow)}
                y={y(sprint.points_completed)}
                width={narrow}
                height={Math.max(plot - (y(sprint.points_completed) - PAD.top), 0)}
                rx={4}
                fill={INK.measure}
                stroke="white"
                strokeWidth={2}
                opacity={active ? 1 : 0.95}
              />
              <text
                x={PAD.left + slot * i + slot / 2}
                y={y(Math.max(sprint.points_committed, sprint.points_completed)) - 6}
                textAnchor="middle"
                className="fill-neutral-700"
                style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
              >
                {sprint.points_completed}/{sprint.points_committed}
              </text>
              <text
                x={PAD.left + slot * i + slot / 2}
                y={H - PAD.bottom + 14}
                textAnchor="middle"
                className="fill-neutral-400"
                style={{ fontSize: 10 }}
              >
                {sprint.sprint_name}
              </text>
            </g>
          )
        })}

        {averageY !== null && (
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={averageY}
            y2={averageY}
            stroke={INK.contrastSeries}
            strokeWidth={2}
            strokeDasharray="4 4"
          />
        )}
      </svg>
    </Figure>
  )
}
