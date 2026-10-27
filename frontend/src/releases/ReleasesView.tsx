import { useQueryClient } from '@tanstack/react-query'
import { parseISO } from 'date-fns'
import { type ReactNode, useState } from 'react'

import { errorDetail } from '@/api/errors'
import {
  useDeleteReleaseReleasesReleaseIdDelete,
  useUpdateReleaseReleasesReleaseIdPatch,
} from '@/api/generated/endpoints/releases/releases'
import { useListTicketsTeamsTeamIdTicketsGet } from '@/api/generated/endpoints/tickets/tickets'
import type { ReleaseRead, ReleaseState, TicketRead } from '@/api/generated/models'
import { TicketRow } from '@/board/TicketListView'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { ReleaseDialog } from '@/releases/ReleaseDialog'
import { ReleaseFormDialog } from '@/releases/ReleaseFormDialog'
import { ReleaseNotesDialog } from '@/releases/ReleaseNotesDialog'
import {
  comingRelease,
  invalidateReleases,
  releaseRatio,
  releaseStateMeta,
} from '@/releases/releases'
import { useCanWrite } from '@/team/useCanWrite'
import { useTeamContext } from '@/team/useTeamContext'
import { TicketActionsMenu, type TicketAction } from '@/tickets/detail/TicketActionsMenu'
import { invalidateTicketWrites } from '@/tickets/invalidateTickets'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

/** The most tickets one release's page lists: the list endpoint's page. */
const PAGE = 200

/**
 * The Releases tab (#272), beside Reports: the versions a team ships on the
 * left, and one of them on the right -- its state and target date, its
 * progress, what is not done yet and then what is done.
 *
 * A sprint says when work was done and an epic what it was part of; this
 * says which version it shipped in. Releasing asks what to do with what is
 * not done, and the notes are drafted from what is.
 */
export function ReleasesView() {
  const { t } = useTranslation(['releases', 'common'])
  const { releases = [] } = useTeamContext()
  const canWrite = useCanWrite()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  const active = releases.filter((release) => release.state !== 'archived')
  const archived = releases.filter((release) => release.state === 'archived')
  // The one chosen, else the one coming next, else the newest.
  const selected =
    releases.find((release) => release.id === selectedId) ??
    comingRelease(releases) ??
    releases[0] ??
    null

  const newRelease = canWrite && (
    <button type="button" onClick={() => setCreating(true)} className="btn btn-primary btn-sm">
      <Icon name="plus" size={13} strokeWidth={2.2} />
      {t('list.newRelease')}
    </button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 lg:flex-row">
      {releases.length === 0 ? (
        <section className="glass flex flex-1 flex-col items-center justify-center gap-3 rounded-panel px-6 py-16 text-center">
          <Icon name="flag" size={22} className="text-neutral-400" />
          <h2 className="text-sm font-semibold text-neutral-900">{t('empty.title')}</h2>
          <p className="max-w-md text-sm text-neutral-500">
            {canWrite ? t('empty.body') : t('empty.guest')}
          </p>
          {newRelease}
        </section>
      ) : (
        <>
          <nav
            aria-label={t('list.label')}
            className="glass scroll-thin shrink-0 overflow-y-auto rounded-panel p-3 lg:w-60"
          >
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <h2 className="eyebrow">{t('list.heading')}</h2>
              {newRelease}
            </div>
            <ul className="space-y-0.5">
              {active.map((release) => (
                <ReleaseItem
                  key={release.id}
                  release={release}
                  selected={release.id === selected?.id}
                  onSelect={() => setSelectedId(release.id)}
                />
              ))}
            </ul>
            {archived.length > 0 && (
              <>
                <h3 className="eyebrow mt-4 px-1 pb-1">{t('list.archived')}</h3>
                <ul className="space-y-0.5">
                  {archived.map((release) => (
                    <ReleaseItem
                      key={release.id}
                      release={release}
                      selected={release.id === selected?.id}
                      onSelect={() => setSelectedId(release.id)}
                    />
                  ))}
                </ul>
              </>
            )}
          </nav>

          {selected && (
            <ReleasePage
              key={selected.id}
              release={selected}
              onDeleted={() => setSelectedId(null)}
            />
          )}
        </>
      )}

      {creating && (
        <ReleaseFormDialog
          onClose={() => setCreating(false)}
          onSaved={(release) => setSelectedId(release.id)}
        />
      )}
    </div>
  )
}

/** A release in the list: its name, and its target date or its state. */
function ReleaseItem({
  release,
  selected,
  onSelect,
}: {
  release: ReleaseRead
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation('releases')
  const aside =
    release.state === 'planned'
      ? release.target_date
        ? formatDate(parseISO(release.target_date), t('list.targetPattern'))
        : t('list.planned')
      : release.state === 'released'
        ? t('list.released')
        : null
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected || undefined}
        data-active={selected}
        className="nav-item w-full justify-between gap-2"
      >
        <span className="truncate font-mono text-[13px]">{release.name}</span>
        {aside && <span className="shrink-0 text-xs text-neutral-400">{aside}</span>}
      </button>
    </li>
  )
}

/** A state as a chip: Planned, Released, Archived. */
export function ReleaseStateChip({ state }: { state: ReleaseState }) {
  const meta = releaseStateMeta(state)
  return (
    <span className="chip" style={{ ['--chip' as string]: meta.colour }}>
      {meta.label}
    </span>
  )
}

/** One release: what is in it, how far along, and what is not done yet first. */
function ReleasePage({ release, onDeleted }: { release: ReleaseRead; onDeleted: () => void }) {
  const { t } = useTranslation(['releases', 'common'])
  const { team } = useTeamContext()
  const canWrite = useCanWrite()
  const queryClient = useQueryClient()
  const update = useUpdateReleaseReleasesReleaseIdPatch()
  const remove = useDeleteReleaseReleasesReleaseIdDelete()
  const [dialog, setDialog] = useState<'edit' | 'release' | 'notes' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const tickets = useListTicketsTeamsTeamIdTicketsGet(team.id, {
    fix_version_id: [release.id],
    limit: PAGE,
  })
  const items = tickets.data?.items ?? []
  const done = items.filter((ticket) => ticket.status.category === 'done')
  const cancelled = items.filter((ticket) => ticket.status.category === 'cancelled')
  const notDone = items.filter(
    (ticket) => ticket.status.category !== 'done' && ticket.status.category !== 'cancelled',
  )

  const setState = async (state: ReleaseState) => {
    setError(null)
    try {
      await update.mutateAsync({ releaseId: release.id, data: { state } })
      invalidateReleases(queryClient, team.id)
    } catch (err: unknown) {
      setError(errorDetail(err, t('page.actionError')))
    }
  }

  const deleteIt = async () => {
    if (!window.confirm(t('page.confirmDelete', { name: release.name }))) return
    setError(null)
    try {
      await remove.mutateAsync({ releaseId: release.id })
      invalidateReleases(queryClient, team.id)
      invalidateTicketWrites(queryClient, team.id)
      onDeleted()
    } catch (err: unknown) {
      setError(errorDetail(err, t('page.actionError')))
    }
  }

  const actions: TicketAction[] = canWrite
    ? [
        { label: t('page.edit'), icon: 'pencil', onSelect: () => setDialog('edit') },
        ...(release.state === 'archived'
          ? [
              {
                label: t('page.unarchive'),
                icon: 'archive' as const,
                onSelect: () => setState(release.released_on ? 'released' : 'planned'),
              },
            ]
          : [
              {
                label: t('page.archive'),
                icon: 'archive' as const,
                onSelect: () => setState('archived'),
              },
            ]),
        ...(release.state === 'released'
          ? [{ label: t('page.reopen'), icon: 'undo' as const, onSelect: () => setState('planned') }]
          : []),
        { label: t('page.delete'), icon: 'trash', destructive: true, onSelect: deleteIt },
      ]
    : []

  const { progress } = release
  const datePattern = t('page.datePattern')

  return (
    <section
      aria-labelledby={`release-${release.id}`}
      className="glass scroll-thin min-h-0 flex-1 overflow-y-auto rounded-panel"
    >
      <header className="hairline border-b px-5 pb-4 pt-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2
            id={`release-${release.id}`}
            className="font-mono text-xl font-semibold tracking-tight text-neutral-900"
          >
            {release.name}
          </h2>
          <ReleaseStateChip state={release.state} />
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => setDialog('notes')} className="btn btn-secondary btn-sm">
              {t('page.notes')}
            </button>
            {canWrite && release.state === 'planned' && (
              <button type="button" onClick={() => setDialog('release')} className="btn btn-primary btn-sm">
                <Icon name="check" size={13} strokeWidth={2.2} />
                {t('page.release')}
              </button>
            )}
            <TicketActionsMenu
              actions={actions}
              label={t('page.more', { name: release.name })}
              menuLabel={t('page.menu')}
            />
          </div>
        </div>
        {(release.description || release.target_date || release.released_on) && (
          <p className="mt-1.5 max-w-2xl text-sm text-neutral-600">
            {release.description}
            {release.description && ' '}
            {release.released_on
              ? t('page.released', {
                  date: formatDate(parseISO(release.released_on), datePattern),
                })
              : release.target_date &&
                t('page.target', { date: formatDate(parseISO(release.target_date), datePattern) })}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div
            role="progressbar"
            aria-label={t('page.progressLabel', { name: release.name })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(releaseRatio(release) * 100)}
            className="h-1.5 min-w-40 flex-1 overflow-hidden rounded-full bg-neutral-900/8"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-sky"
              style={{ width: `${releaseRatio(release) * 100}%` }}
            />
          </div>
          <span className="identifier text-xs text-neutral-500">
            {progress.points_total > 0 &&
              `${t('page.points', { done: progress.points_done, total: progress.points_total })} · `}
            {t('page.tickets', { done: progress.tickets_done, count: progress.tickets_total })}
          </span>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger-600">
            {error}
          </p>
        )}
      </header>

      {tickets.isLoading ? (
        <Loading label={t('page.loading')} />
      ) : tickets.isError ? (
        <p className="px-5 py-10 text-center text-sm text-danger-600">{t('page.error')}</p>
      ) : items.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-neutral-500">
          {t('page.empty', { name: release.name })}
        </p>
      ) : (
        <>
          {/* What is not done comes first: it is what the release is waiting for. */}
          {notDone.length > 0 ? (
            <TicketSection title={t('page.notDone')} tickets={notDone} />
          ) : (
            <p className="px-5 pt-4 text-sm text-neutral-600">
              {t('page.allDone', { name: release.name })}
            </p>
          )}
          {done.length > 0 && <TicketSection title={t('page.done')} tickets={done} />}
          {cancelled.length > 0 && (
            <TicketSection title={t('page.cancelled')} tickets={cancelled} />
          )}
        </>
      )}

      {dialog === 'edit' && (
        <ReleaseFormDialog release={release} onClose={() => setDialog(null)} />
      )}
      {dialog === 'release' && (
        <ReleaseDialog release={release} onClose={() => setDialog(null)} />
      )}
      {dialog === 'notes' && (
        <ReleaseNotesDialog release={release} onClose={() => setDialog(null)} />
      )}
    </section>
  )
}

function TicketSection({ title, tickets }: { title: ReactNode; tickets: TicketRead[] }) {
  return (
    <section className="pt-3">
      <h3 className="eyebrow flex items-center gap-2 px-5 pb-1.5">
        {title}
        <span className="identifier font-medium text-neutral-400">{tickets.length}</span>
      </h3>
      <ul className="divide-y divide-neutral-900/8">
        {tickets.map((ticket) => (
          <TicketRow key={ticket.id} ticket={ticket} showProject />
        ))}
      </ul>
    </section>
  )
}
