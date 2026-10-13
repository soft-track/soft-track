import { useState } from 'react'
import { Link } from 'react-router-dom'

import { getWorkloadUsersUsernameWorkloadGet } from '@/api/generated/endpoints/people/people'
import type {
  TeamCapacity,
  WorkloadRead,
  WorkloadTeam,
  WorkloadTicket,
} from '@/api/generated/models'
import { Trans, userText, useTranslation } from '@/i18n'
import { PriorityIcon } from '@/tickets/PriorityIcon'
import { formatDuration } from '@/tickets/duration'
import { ticketPath } from '@/tickets/surface'
import { Icon } from '@/ui/Icon'

/** How many of a team's tickets a group shows before "Show more". */
export const PER_TEAM = 5

/**
 * What is on somebody's plate (#127): their open tickets, grouped by the
 * teams you share with them.
 *
 * Every number here comes from the database, the way sprint rollups do --
 * a group's count and points are the whole team's, not the page's, and each
 * group pages on its own. Teams you are not on are neither listed nor
 * counted, whoever you are.
 */
export function WorkloadTab({
  username,
  name,
  isYou,
  workload,
}: {
  username: string
  name: string
  isYou: boolean
  workload: WorkloadRead
}) {
  const { t } = useTranslation(['people', 'common'])

  const capacity = (workload.capacity ?? []).length > 0 && (
    <Capacities name={name} isYou={isYou} capacity={workload.capacity ?? []} />
  )

  if (workload.open_count === 0) {
    return (
      <div className="space-y-4">
        {capacity}
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Icon name="check" size={26} className="text-neutral-300" />
          <p className="text-sm text-neutral-800">
            {isYou ? t('workload.emptyYours') : t('workload.empty', { name })}
          </p>
          <p className="text-xs text-neutral-400">{t('workload.emptyHint')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {capacity}
      <p className="text-sm text-neutral-500">
        <Trans
          t={t}
          i18nKey={isYou ? 'workload.summaryYours' : 'workload.summary'}
          count={workload.open_count}
          values={{ name }}
          components={{ strong: <strong className="font-semibold text-neutral-900" /> }}
          {...userText}
        />
        <span className="text-neutral-400"> · </span>
        <strong className="font-semibold text-neutral-900">
          {t('workload.points', { count: workload.points })}
        </strong>
      </p>
      {workload.teams.map((group) => (
        <TeamGroup key={group.team.id} username={username} group={group} />
      ))}
    </div>
  )
}

/**
 * Somebody's capacity on each team you share with them (#269), in the
 * sprint each is planning: what they have against what they can take.
 * Capacity is per team, so somebody on two teams has one in each.
 */
function Capacities({
  name,
  isYou,
  capacity,
}: {
  name: string
  isYou: boolean
  capacity: TeamCapacity[]
}) {
  const { t } = useTranslation(['people', 'common'])
  const title = isYou ? t('workload.capacity.titleYours') : t('workload.capacity.title', { name })
  return (
    <section aria-label={title} className="well rounded-card px-4 py-3">
      <p className="eyebrow">{title}</p>
      <ul className="mt-2 space-y-3">
        {capacity.map((row) => {
          const hours = row.unit === 'hours'
          const assigned = hours ? row.minutes_assigned : row.points_assigned
          const most = hours ? row.minutes_capacity : row.points_capacity
          const over = assigned > most
          const ratio = most > 0 ? Math.min(assigned / most, 1) : assigned > 0 ? 1 : 0
          const amount = hours
            ? t('workload.capacity.hours', {
                assigned: formatDuration(assigned),
                capacity: formatDuration(most),
              })
            : t('workload.capacity.points', { assigned, capacity: most })
          return (
            <li key={row.team.id}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-neutral-900">
                  <Link to={`/${row.team.key}`} className="hover:underline">
                    {row.team.name}
                  </Link>
                  <span className="ml-2 text-xs text-neutral-400">{row.sprint}</span>
                </span>
                <span className="flex items-center gap-2">
                  {over && (
                    <span
                      className="chip"
                      style={{ ['--chip' as string]: 'var(--color-danger-600)' }}
                    >
                      {t('workload.capacity.over')}
                    </span>
                  )}
                  <span className="identifier text-xs text-neutral-600">{amount}</span>
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={t('workload.capacity.bar', { team: row.team.name })}
                aria-valuemin={0}
                aria-valuemax={most}
                aria-valuenow={Math.min(assigned, most)}
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-900/8"
              >
                <div
                  className={`h-full rounded-full ${
                    over ? 'bg-danger-500' : 'bg-linear-to-r from-brand-500 to-accent-sky'
                  }`}
                  style={{ width: `${ratio * 100}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-xs text-neutral-500">{t('workload.capacity.hint')}</p>
    </section>
  )
}

/** One team's share: its totals, a page of tickets, and the rest on demand. */
function TeamGroup({ username, group }: { username: string; group: WorkloadTeam }) {
  const { t } = useTranslation(['people', 'common'])
  const [more, setMore] = useState<WorkloadTicket[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const tickets = [...group.tickets, ...more]
  const left = group.open_count - tickets.length

  const showMore = async () => {
    setLoading(true)
    setFailed(false)
    try {
      const page = await getWorkloadUsersUsernameWorkloadGet(username, {
        team_id: group.team.id,
        offset: tickets.length,
        per_team: 20,
      })
      setMore((shown) => [...shown, ...(page.teams[0]?.tickets ?? [])])
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section aria-label={group.team.name} className="well overflow-hidden rounded-card">
      <header className="hairline flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <h3 className="flex items-baseline gap-2 text-sm font-semibold text-neutral-900">
          <Link to={`/${group.team.key}`} className="hover:underline">
            {group.team.name}
          </Link>
          <span className="identifier text-[10px] font-normal text-neutral-400">
            {group.team.key}
          </span>
        </h3>
        <p className="text-xs text-neutral-500">
          {t('workload.teamOpen', { count: group.open_count })}
          <span className="text-neutral-400"> · </span>
          {t('workload.teamPoints', { count: group.points })}
        </p>
      </header>
      <ul>
        {tickets.map((ticket) => (
          <TicketRow key={ticket.id} ticket={ticket} />
        ))}
      </ul>
      {(left > 0 || failed) && (
        <div className="hairline border-t px-4 py-2">
          {failed && <p className="mb-1 text-xs text-danger-600">{t('workload.moreError')}</p>}
          {left > 0 && (
            <button
              type="button"
              onClick={showMore}
              disabled={loading}
              className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-60 dark:text-brand-300"
            >
              {t('workload.showMore', { count: left })}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function TicketRow({ ticket }: { ticket: WorkloadTicket }) {
  const { t } = useTranslation(['people', 'common'])
  return (
    <li className="hairline flex items-center gap-3 border-t px-4 py-2 text-sm first:border-t-0">
      <span className="flex w-28 shrink-0 items-center gap-1.5 truncate text-xs text-neutral-600">
        <span className="dot" style={{ ['--dot' as string]: ticket.status.color }} />
        {ticket.status.name}
      </span>
      <span className="identifier hidden w-16 shrink-0 text-[11px] text-neutral-400 sm:inline">
        {ticket.identifier}
      </span>
      <Link
        to={ticketPath(ticket)}
        className="min-w-0 flex-1 truncate text-neutral-900 hover:underline"
      >
        {ticket.title}
      </Link>
      <PriorityIcon priority={ticket.priority} size={13} />
      <span className="identifier w-12 shrink-0 text-right text-xs text-neutral-500">
        {ticket.estimate != null ? (
          t('workload.estimate', { count: ticket.estimate })
        ) : (
          <span title={t('workload.noEstimate')}>–</span>
        )}
      </span>
      <span className="hidden w-24 shrink-0 truncate text-right text-xs text-neutral-500 md:inline">
        {ticket.sprint ?? t('workload.noSprint')}
      </span>
    </li>
  )
}
