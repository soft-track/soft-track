import { differenceInCalendarDays } from 'date-fns'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { parseServerDate } from '@/api/dates'
import { useSprintTimeSprintsSprintIdTimeGet } from '@/api/generated/endpoints/time-estimates/time-estimates'
import type { SprintRead, TimeRollup } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { EstimateBar, OverChip } from '@/tickets/detail/TimeEstimate'
import { formatDuration } from '@/tickets/duration'
import { ticketPath } from '@/tickets/surface'

/**
 * A sprint's or an epic's time (#268): estimated, logged and remaining, and
 * under it the tickets that are over their estimate, each labelled so --
 * over is not shown by colour alone. A parent's figures include its
 * sub-tickets.
 */
export function TimeRollupBlock({
  title,
  rollup,
  after,
}: {
  title: string
  rollup: TimeRollup
  /** Said after what is left: "4 days to go". */
  after?: string
}) {
  const { t } = useTranslation('tickets')
  const left = t('timeEstimate.rollup.left', {
    left: formatDuration(rollup.remaining_minutes),
  })
  return (
    <div className="divide-y divide-neutral-900/8">
      <Figures
        title={title}
        logged={rollup.logged_minutes}
        estimated={rollup.estimated_minutes}
        note={after ? `${left} · ${after}` : left}
      />
      {rollup.over.length > 0 && (
        <ul
          aria-label={t('timeEstimate.rollup.overList')}
          className="divide-y divide-neutral-900/8"
        >
          {rollup.over.map((ticket) => (
            <li key={ticket.id}>
              <Figures
                title={
                  <Link to={ticketPath(ticket)} className="hover:underline">
                    {ticket.identifier} {ticket.title}
                  </Link>
                }
                chip={<OverChip by={ticket.logged_minutes - ticket.estimated_minutes} />}
                logged={ticket.logged_minutes}
                estimated={ticket.estimated_minutes}
                note={t('timeEstimate.rollup.left', {
                  left: formatDuration(ticket.remaining_minutes),
                })}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Figures({
  title,
  chip,
  logged,
  estimated,
  note,
}: {
  title: ReactNode
  chip?: ReactNode
  logged: number
  estimated: number
  note: string
}) {
  const { t } = useTranslation('tickets')
  const of = t('timeEstimate.rollup.of', {
    logged: formatDuration(logged),
    estimated: formatDuration(estimated),
  })
  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm text-neutral-900">{title}</p>
        {chip}
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        {estimated > 0 ? (
          <EstimateBar logged={logged} estimated={estimated} />
        ) : (
          <div className="h-1.5 flex-1 rounded-full bg-neutral-900/8" />
        )}
        <span className="identifier shrink-0 text-[11px] text-neutral-500">{of}</span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">{note}</p>
    </div>
  )
}

/**
 * The sprint's time, below its banner, for a team that estimates in hours
 * (#268): a card of its own, like the retrospective under a finished one.
 */
export function SprintTimeCard({ sprint }: { sprint: SprintRead }) {
  const { t } = useTranslation('tickets')
  const time = useSprintTimeSprintsSprintIdTimeGet(sprint.id).data
  if (!time) return null
  const ends = parseServerDate(sprint.ends_at)
  const days = differenceInCalendarDays(ends, new Date())
  const after =
    sprint.state !== 'completed' && days > 0
      ? t('timeEstimate.rollup.daysToGo', { count: days })
      : undefined
  return (
    <section className="glass rounded-panel px-4 py-3" aria-label={sprint.display_name}>
      <p className="eyebrow mb-2">{sprint.display_name}</p>
      <TimeRollupBlock title={t('timeEstimate.rollup.sprint')} rollup={time} after={after} />
    </section>
  )
}
