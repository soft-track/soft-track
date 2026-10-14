import { parseISO } from 'date-fns'

import type { OpenBugsBySeverity, TicketSeverity } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { Figure, Key, Tooltip, XAxis, YAxis } from '@/reports/Chart'
import { PAD, useCrosshair } from '@/reports/chartGeometry'
import { INK } from '@/reports/chartTokens'
import { SEVERITY_META, SEVERITY_ORDER } from '@/tickets/ticketMeta'

const W = 640
const H = 180

/**
 * Open bugs by severity, week by week (#273): what was open at the end of
 * each week, a line per severity in its own colour, critical on top of the
 * legend. Bugs with no severity are counted in the tooltip, so the lines
 * plus that number are every open bug.
 *
 * Lines rather than stacked bands: the question is whether the critical
 * ones are going down, and a stack would draw them on top of the rest.
 */
export function OpenBugsChart({ data }: { data: OpenBugsBySeverity }) {
  const { t } = useTranslation(['reports', 'common'])
  const weeks = data.weeks
  const { index, onMove, onLeave } = useCrosshair(weeks.length)

  const total = (week: OpenBugsBySeverity['weeks'][number]) =>
    SEVERITY_ORDER.reduce((sum, severity) => sum + week[severity], 0) + week.unrated
  // A line for each severity some week has; one never used is left out.
  const drawn = SEVERITY_ORDER.filter((severity) => weeks.some((week) => week[severity] > 0))
  const max = Math.max(1, ...weeks.flatMap((week) => drawn.map((severity) => week[severity])))
  const inner = W - PAD.left - PAD.right
  const plot = H - PAD.top - PAD.bottom
  const x = (i: number) =>
    PAD.left + (weeks.length === 1 ? inner / 2 : (inner * i) / (weeks.length - 1))
  const y = (value: number) => PAD.top + plot * (1 - value / max)

  const now = weeks.length > 0 ? total(weeks[weeks.length - 1]) : 0
  const nothing = weeks.every((week) => total(week) === 0)
  const hovered = index !== null ? weeks[index] : null
  const line = (severity: TicketSeverity) =>
    weeks.map((week, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(week[severity])}`).join(' ')

  return (
    <Figure
      title={t('openBugs.title')}
      note={t('openBugs.note', { count: now })}
      empty={nothing ? t('openBugs.empty') : undefined}
      legend={drawn.map((severity) => (
        <Key key={severity} colour={SEVERITY_META[severity].color} label={SEVERITY_META[severity].label} />
      ))}
    >
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={t('openBugs.chart')}
          onMouseMove={(e) => onMove(e, W)}
          onMouseLeave={onLeave}
        >
          {/* Whole bugs: no more gridlines than there are bugs to count. */}
          <YAxis max={max} width={W} height={H} ticks={Math.min(4, max)} />
          {/* Least severe first, so where lines meet the critical one is on top. */}
          {[...drawn].reverse().map((severity) => (
            <path
              key={severity}
              d={line(severity)}
              fill="none"
              stroke={SEVERITY_META[severity].color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
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
            labels={weeks.map((week) =>
              formatDate(parseISO(week.week_of), t('openBugs.weekPattern')),
            )}
            width={W}
            height={H}
          />
        </svg>

        {hovered && (
          <Tooltip
            x={x(index!)}
            width={W}
            title={t('openBugs.weekOf', {
              date: formatDate(parseISO(hovered.week_of), t('openBugs.weekPattern')),
            })}
            rows={[
              ...SEVERITY_ORDER.map((severity) => ({
                colour: SEVERITY_META[severity].color,
                label: SEVERITY_META[severity].label,
                value: String(hovered[severity]),
              })),
              { label: t('openBugs.unrated'), value: String(hovered.unrated) },
            ]}
          />
        )}
      </div>
    </Figure>
  )
}
