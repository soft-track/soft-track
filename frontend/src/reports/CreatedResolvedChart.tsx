import { format, parseISO } from 'date-fns'

import type { CreatedVsResolved } from '@/api/generated/models'
import { Figure, Key, Tooltip, XAxis, YAxis } from '@/reports/Chart'
import { PAD, useCrosshair } from '@/reports/chartGeometry'
import { INK } from '@/reports/chartTokens'

const W = 640
const H = 180
const BACKLOG_H = 90

/**
 * Issues opened against issues closed, with the resulting backlog below.
 *
 * Two plots sharing one x-axis rather than one plot with two y-scales. A
 * handful of issues a day and a backlog of several hundred do not belong on
 * the same scale -- putting them there needs a second axis, and a dual-axis
 * chart lets the author decide which line looks like it is winning.
 */
export function CreatedResolvedChart({ data }: { data: CreatedVsResolved }) {
  const days = data.days
  const { index, onMove, onLeave } = useCrosshair(days.length)

  const max = Math.max(1, ...days.flatMap((d) => [d.created, d.resolved]))
  const backlogMax = Math.max(1, ...days.map((d) => d.open_at_end_of_day))
  const inner = W - PAD.left - PAD.right
  const plot = H - PAD.top - PAD.bottom
  const slot = inner / Math.max(days.length, 1)
  const barW = Math.max(Math.min(slot * 0.38, 14), 2)

  const x = (i: number) => PAD.left + slot * i + slot / 2
  const y = (value: number) => PAD.top + plot * (1 - value / max)

  const hovered = index !== null ? days[index] : null
  const nothing = data.total_created === 0 && data.total_resolved === 0

  return (
    <Figure
      title="Created vs resolved"
      note={`${data.total_created} opened and ${data.total_resolved} closed in this window. The lower plot is the backlog those two lines produce.`}
      empty={nothing ? 'Nothing opened or closed in this window.' : undefined}
      legend={
        <>
          <Key colour={INK.measure} label="Created" />
          <Key colour={INK.resolved} label="Resolved" />
        </>
      }
    >
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label="Issues created and resolved per day"
          onMouseMove={(e) => onMove(e, W)}
          onMouseLeave={onLeave}
        >
          <YAxis max={max} width={W} height={H} ticks={2} />
          {days.map((day, i) => (
            <g key={day.day}>
              <rect
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={plot}
                fill="transparent"
              />
              {/* A 2px gap between the pair so the fills never touch. */}
              <rect
                x={x(i) - barW - 1}
                y={y(day.created)}
                width={barW}
                height={Math.max(plot - (y(day.created) - PAD.top), 0)}
                rx={3}
                fill={INK.measure}
              />
              <rect
                x={x(i) + 1}
                y={y(day.resolved)}
                width={barW}
                height={Math.max(plot - (y(day.resolved) - PAD.top), 0)}
                rx={3}
                fill={INK.resolved}
              />
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
            labels={days.map((d) => format(parseISO(d.day), 'd MMM'))}
            width={W}
            height={H}
          />
        </svg>

        <p className="mt-1 mb-0.5 text-[11px] uppercase tracking-wide text-neutral-400">
          Open issues
        </p>
        <svg
          viewBox={`0 0 ${W} ${BACKLOG_H}`}
          className="w-full"
          role="img"
          aria-label="Open issues at the end of each day"
        >
          <YAxis max={backlogMax} width={W} height={BACKLOG_H} ticks={1} />
          <path
            d={days
              .map(
                (day, i) =>
                  `${i === 0 ? 'M' : 'L'}${x(i)},${
                    PAD.top +
                    (BACKLOG_H - PAD.top - PAD.bottom) *
                      (1 - day.open_at_end_of_day / backlogMax)
                  }`,
              )
              .join(' ')}
            fill="none"
            stroke={INK.axis}
            strokeWidth={2}
          />
        </svg>

        {hovered && (
          <Tooltip
            x={x(index!)}
            width={W}
            title={format(parseISO(hovered.day), 'EEE d MMM')}
            rows={[
              { colour: INK.measure, label: 'Created', value: String(hovered.created) },
              { colour: INK.resolved, label: 'Resolved', value: String(hovered.resolved) },
              { label: 'Open', value: String(hovered.open_at_end_of_day) },
            ]}
          />
        )}
      </div>
    </Figure>
  )
}
