import type { SprintPlan } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { Figure, Key, YAxis } from '@/reports/Chart'
import { PAD } from '@/reports/chartGeometry'
import { INK } from '@/reports/chartTokens'
import type { PlanUnit } from '@/sprints/plan'
import { formatDuration } from '@/tickets/duration'

const W = 520
const H = 200
const PLANNED = 'var(--color-brand-300)'

/**
 * The last three sprints, sprint by sprint, and the one being planned (#269):
 * what each held when it started against what it delivered, and the average
 * of what was delivered as a dashed line to plan against. It suggests; it
 * does not set.
 *
 * In hours there is no "held when it started" to draw -- the history of time
 * estimates starts with #268 -- so the past sprints show what they delivered.
 */
export function DeliveredChart({ plan, unit }: { plan: SprintPlan; unit: PlanUnit }) {
  const { t } = useTranslation('sprints')
  const hours = unit === 'hours'
  const label = (value: number) => (hours ? formatDuration(value) : String(value))

  const bars = [
    ...plan.history.map((sprint) => ({
      key: sprint.sprint_id,
      name: sprint.display_name,
      planned: hours ? null : sprint.points_planned,
      delivered: hours ? sprint.minutes_delivered : sprint.points_delivered,
    })),
    {
      key: plan.sprint.id,
      name: plan.sprint.display_name,
      planned: hours ? plan.scope_minutes : plan.scope_points,
      delivered: null,
    },
  ]
  const average = hours ? plan.average_minutes : plan.average_points

  const highest = Math.max(
    1,
    average ?? 0,
    ...bars.flatMap((bar) => [bar.planned ?? 0, bar.delivered ?? 0]),
  )
  // Points get a labelled axis on whole numbers; hours, gridlines only.
  const max = hours ? highest : Math.max(4, Math.ceil((highest * 1.15) / 4) * 4)
  const inner = W - PAD.left - PAD.right
  const plot = H - PAD.top - PAD.bottom
  const slot = inner / bars.length
  const width = Math.min(slot * 0.28, 26)
  const y = (value: number) => PAD.top + plot * (1 - value / max)
  const height = (value: number) => Math.max(plot - (y(value) - PAD.top), 0)

  return (
    <Figure
      title={t('plan.chart.title')}
      note={hours ? t('plan.chart.noteHours') : t('plan.chart.notePoints')}
      legend={
        <>
          <Key colour={PLANNED} label={t('plan.chart.planned')} />
          <Key colour={INK.measure} label={t('plan.chart.delivered')} />
        </>
      }
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-xl"
        role="img"
        aria-label={t('plan.chart.label')}
      >
        {hours ? (
          [0, 0.5, 1].map((fraction) => (
            <line
              key={fraction}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(max * fraction)}
              y2={y(max * fraction)}
              stroke={INK.grid}
              strokeWidth={1}
            />
          ))
        ) : (
          <YAxis max={max} width={W} height={H} />
        )}
        {bars.map((bar, i) => {
          const middle = PAD.left + slot * i + slot / 2
          const both = bar.planned !== null && bar.delivered !== null
          const plannedX = both ? middle - width - 2 : middle - width / 2
          const deliveredX = both ? middle + 2 : middle - width / 2
          const top = Math.max(bar.planned ?? 0, bar.delivered ?? 0)
          return (
            <g key={bar.key}>
              {bar.planned !== null && (
                <rect
                  x={plannedX}
                  y={y(bar.planned)}
                  width={width}
                  height={height(bar.planned)}
                  rx={3}
                  fill={PLANNED}
                />
              )}
              {bar.delivered !== null && (
                <rect
                  x={deliveredX}
                  y={y(bar.delivered)}
                  width={width}
                  height={height(bar.delivered)}
                  rx={3}
                  fill={INK.measure}
                />
              )}
              <text
                x={middle}
                y={y(top) - 5}
                textAnchor="middle"
                className="fill-neutral-700"
                style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
              >
                {both
                  ? `${label(bar.delivered!)}/${label(bar.planned!)}`
                  : label((bar.delivered ?? bar.planned)!)}
              </text>
              <text
                x={middle}
                y={H - PAD.bottom + 14}
                textAnchor="middle"
                className="fill-neutral-400"
                style={{ fontSize: 10 }}
              >
                {bar.name}
              </text>
            </g>
          )
        })}
        {average != null && plan.history.length > 0 && (
          <g>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(average)}
              y2={y(average)}
              stroke={INK.resolved}
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
            <text
              x={W - PAD.right}
              y={y(average) - 4}
              textAnchor="end"
              style={{ fontSize: 10, fontWeight: 600, fill: INK.resolved }}
            >
              {t('plan.chart.average', { amount: label(average) })}
            </text>
          </g>
        )}
      </svg>
    </Figure>
  )
}
