import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { useListTeamMembersTeamsTeamIdMembersGet } from '@/api/generated/endpoints/teams/teams'
import {
  getListTrashTeamsTeamIdTrashGetQueryKey,
  useListTrashTeamsTeamIdTrashGet,
  usePurgeProjectTrashProjectsProjectIdDelete,
  usePurgeTicketTrashTicketsTicketIdDelete,
  useRestoreProjectTrashProjectsProjectIdRestorePost,
  useRestoreTicketTrashTicketsTicketIdRestorePost,
} from '@/api/generated/endpoints/trash/trash'
import type { TeamRead, TeamRole, TrashedEpic, TrashedTicket } from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import { useTranslation } from '@/i18n'
import { formatRelative } from '@/i18n/format'
import { TicketTypeIcon } from '@/tickets/TicketTypeIcon'
import { useTeamByKey } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

const DAY = 24 * 60 * 60 * 1000

/** Whole days until the purge, rounded up: "1 day" until it has gone. */
function daysLeft(purgeAt: string, now = Date.now()): number {
  return Math.max(1, Math.ceil((parseServerDate(purgeAt).getTime() - now) / DAY))
}

/**
 * Settings → a team → Trash (#323): what was deleted, who deleted it, and how
 * long until it is purged, with a way back. Anybody on the team reads it;
 * anybody but a guest restores; a team admin can delete forever sooner.
 */
export default function TeamTrashSettings() {
  const { teamKey } = useParams()
  const { team, isLoading } = useTeamByKey(teamKey)
  const { user } = useAuth()
  const { t } = useTranslation()
  const members = useListTeamMembersTeamsTeamIdMembersGet(team?.id ?? 0, {
    query: { enabled: Boolean(team) },
  })
  const role = members.data?.find((member) => member.user.id === user?.id)?.role

  if (isLoading) return <Loading />
  if (!team) {
    return (
      <div className="glass-strong rounded-panel p-6 text-sm text-neutral-500">
        {t('teamNotFound')}
      </div>
    )
  }
  return <TrashList key={team.id} team={team} role={role} />
}

function TrashList({ team, role }: { team: TeamRead; role: TeamRole | undefined }) {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const trash = useListTrashTeamsTeamIdTrashGet(team.id)
  const restoreTicket = useRestoreTicketTrashTicketsTicketIdRestorePost()
  const purgeTicket = usePurgeTicketTrashTicketsTicketIdDelete()
  const restoreEpic = useRestoreProjectTrashProjectsProjectIdRestorePost()
  const purgeEpic = usePurgeProjectTrashProjectsProjectIdDelete()
  const [kind, setKind] = useState<'tickets' | 'epics'>('tickets')
  const [error, setError] = useState<string | null>(null)

  // Somebody still loading counts as able to: the server refuses a guest
  // whatever this shows (see canWriteIn).
  const canRestore = role !== 'guest'
  const canPurge = role === 'admin'

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getListTrashTeamsTeamIdTrashGetQueryKey(team.id) }),
      // What comes back, or goes for good, is on the board and in the epics.
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/tickets`] }),
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/projects`] }),
    ])

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setError(null)
    try {
      await work()
      await refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, fallback))
    }
  }

  if (trash.isLoading) return <Loading />
  const tickets = trash.data?.tickets ?? []
  const epics = trash.data?.epics ?? []
  const retention = trash.data?.retention_days ?? 30

  return (
    <div className="glass-strong sheen rounded-panel p-6">
      <h1 className="text-lg font-semibold tracking-tight text-neutral-900">{t('trash.title')}</h1>
      <p className="mt-1 text-sm text-neutral-500">{t('trash.intro', { team: team.name })}</p>

      <div className="segmented mt-4" role="tablist" aria-label={t('trash.kinds')}>
        {(['tickets', 'epics'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={kind === value}
            data-active={kind === value}
            onClick={() => setKind(value)}
            className="segmented-item"
          >
            {t(`trash.${value}`)}
            <span className="identifier ml-1.5 text-[11px] text-neutral-400">
              {value === 'tickets' ? tickets.length : epics.length}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
        >
          {error}
        </div>
      )}

      <ul className="mt-4 divide-y divide-neutral-900/8">
        {kind === 'tickets' &&
          tickets.map((ticket) => (
            <TrashRow
              key={ticket.id}
              icon={<TicketTypeIcon type={ticket.type} size={14} />}
              identifier={ticket.identifier}
              name={ticket.title}
              item={ticket}
              canRestore={canRestore}
              canPurge={canPurge}
              onRestore={() =>
                run(
                  () => restoreTicket.mutateAsync({ ticketId: ticket.id }),
                  t('trash.errors.restore'),
                )
              }
              onPurge={() => {
                if (!window.confirm(t('trash.confirmTicket', { identifier: ticket.identifier })))
                  return
                return run(
                  () => purgeTicket.mutateAsync({ ticketId: ticket.id }),
                  t('trash.errors.purge'),
                )
              }}
            />
          ))}
        {kind === 'epics' &&
          epics.map((epic) => (
            <TrashRow
              key={epic.id}
              icon={<span className="dot" style={{ ['--dot' as string]: epic.color }} />}
              name={epic.name}
              detail={t('trash.epicTickets', { count: epic.ticket_count })}
              item={epic}
              canRestore={canRestore}
              canPurge={canPurge}
              onRestore={() =>
                run(
                  () => restoreEpic.mutateAsync({ projectId: epic.id }),
                  t('trash.errors.restore'),
                )
              }
              onPurge={() => {
                if (!window.confirm(t('trash.confirmEpic', { name: epic.name }))) return
                return run(
                  () => purgeEpic.mutateAsync({ projectId: epic.id }),
                  t('trash.errors.purge'),
                )
              }}
            />
          ))}
      </ul>
      {((kind === 'tickets' && tickets.length === 0) ||
        (kind === 'epics' && epics.length === 0)) && (
        <p className="py-6 text-center text-sm text-neutral-400">
          {kind === 'tickets' ? t('trash.emptyTickets') : t('trash.emptyEpics')}
        </p>
      )}

      <p className="mt-4 border-t border-neutral-900/8 pt-3 text-xs text-neutral-500">
        {t('trash.footer', { count: retention })} {canPurge ? '' : t('trash.adminsPurge')}
      </p>
    </div>
  )
}

/** One thing in the trash, with Restore and Delete forever. */
function TrashRow({
  icon,
  identifier,
  name,
  detail,
  item,
  canRestore,
  canPurge,
  onRestore,
  onPurge,
}: {
  icon: React.ReactNode
  identifier?: string
  name: string
  detail?: string
  item: TrashedTicket | TrashedEpic
  canRestore: boolean
  canPurge: boolean
  onRestore: () => void
  onPurge: () => void
}) {
  const { t } = useTranslation('settings')
  const label = identifier ?? name
  const when = formatRelative(parseServerDate(item.deleted_at))
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <span className="flex shrink-0 items-center gap-2">
        {icon}
        {identifier && (
          <span className="identifier w-16 text-xs font-medium text-neutral-500">{identifier}</span>
        )}
      </span>
      <div className="min-w-[12rem] flex-1">
        <p className="truncate text-sm text-neutral-900">{name}</p>
        <p className="text-xs text-neutral-500">
          {detail && <>{detail} · </>}
          {item.deleted_by
            ? t('trash.deletedBy', { name: item.deleted_by.full_name, when })
            : t('trash.deletedByNobody', { when })}{' '}
          ·{' '}
          <span className="font-medium text-neutral-600">
            {t('trash.purgedIn', { count: daysLeft(item.purge_at) })}
          </span>
        </p>
      </div>
      {canRestore && (
        <button
          type="button"
          onClick={onRestore}
          aria-label={t('trash.restoreNamed', { name: label })}
          className="btn btn-secondary btn-sm"
        >
          <Icon name="undo" size={13} />
          {t('trash.restore')}
        </button>
      )}
      {canPurge && (
        <button
          type="button"
          onClick={onPurge}
          aria-label={t('trash.deleteForeverNamed', { name: label })}
          className="btn btn-danger-ghost btn-sm"
        >
          {t('trash.deleteForever')}
        </button>
      )}
    </li>
  )
}
