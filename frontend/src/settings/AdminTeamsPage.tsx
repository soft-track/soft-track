import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'

import {
  useAppointTeamAdminAdminTeamsTeamIdAdminsPost,
  useArchiveTeamAdminTeamsTeamIdArchivePost,
  useDeleteTeamAdminTeamsTeamIdDelete,
  useListTeamMembersAdminTeamsTeamIdMembersGet,
  useListTeamsAdminTeamsGet,
  useListUsersAdminUsersGet,
  useUnarchiveTeamAdminTeamsTeamIdUnarchivePost,
} from '@/api/generated/endpoints/admin/admin'
import { AdminTeamFilter, type AdminTeamRead } from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import { useTranslation } from '@/i18n'
import { formatDate, formatList, formatRelative } from '@/i18n/format'
import { departmentColor } from '@/people/departmentColor'
import { type PersonOption, PersonPicker } from '@/people/PersonPicker'
import { useDebounced } from '@/search/useDebounced'
import { TicketActionsMenu } from '@/tickets/detail/TicketActionsMenu'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { useFocusTrap } from '@/ui/useFocusTrap'

const PAGE_SIZE = 50

const FILTERS = [
  { filter: null, label: 'adminTeams.filters.all' },
  { filter: AdminTeamFilter.quiet, label: 'adminTeams.filters.quiet' },
  { filter: AdminTeamFilter.one_admin, label: 'adminTeams.filters.oneAdmin' },
  { filter: AdminTeamFilter.archived, label: 'adminTeams.filters.archived' },
] as const

/**
 * Administration → Teams (#307): every team on the instance, for a site admin.
 *
 * Sizes, dates and names -- never a ticket. The count is a number, and
 * reading a team's work still takes being on it. From a row: appoint an
 * admin, archive or unarchive, and delete a team with no tickets.
 */
export default function AdminTeamsPage() {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<AdminTeamFilter | null>(null)
  const [offset, setOffset] = useState(0)
  const [appointing, setAppointing] = useState<AdminTeamRead | null>(null)
  const [error, setError] = useState<string | null>(null)

  const q = useDebounced(search, 250)
  const teams = useListTeamsAdminTeamsGet({
    q: q || undefined,
    filter: filter ?? undefined,
    limit: PAGE_SIZE,
    offset,
  })
  const archive = useArchiveTeamAdminTeamsTeamIdArchivePost()
  const unarchive = useUnarchiveTeamAdminTeamsTeamIdUnarchivePost()
  const remove = useDeleteTeamAdminTeamsTeamIdDelete()

  // The site admin's own team list too: archiving one they are on takes it
  // out of their switcher (#322), and deleting one takes it away.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['/admin/teams'] }),
      queryClient.invalidateQueries({ queryKey: ['/teams'] }),
    ])

  const act = async (run: () => Promise<unknown>, failure: string) => {
    setError(null)
    try {
      await run()
      await refresh()
    } catch (err: unknown) {
      setError(errorDetail(err, failure))
    }
  }

  const onDelete = (team: AdminTeamRead) => {
    if (!window.confirm(t('adminTeams.confirmDelete', { team: team.name }))) return
    void act(() => remove.mutateAsync({ teamId: team.id }), t('adminTeams.errors.delete'))
  }

  const total = teams.data?.total ?? 0
  const rows = teams.data?.items ?? []

  return (
    <div className="space-y-4">
      <section className="glass-strong sheen rounded-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-prose">
            <h1 className="text-lg font-semibold tracking-tight text-neutral-900">
              {t('adminTeams.title')}
            </h1>
            <p className="mt-1 text-sm text-neutral-500">{t('adminTeams.intro')}</p>
          </div>
          <span className="chip whitespace-nowrap" style={{ ['--chip' as string]: 'var(--color-brand-500)' }}>
            {t('adminTeams.siteAdmin')}
          </span>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <label className="relative block w-full max-w-xs">
            <span className="sr-only">{t('adminTeams.searchLabel')}</span>
            <Icon
              name="search"
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setOffset(0)
              }}
              className="field pl-8"
              placeholder={t('adminTeams.searchPlaceholder')}
            />
          </label>
          <div className="segmented" role="group" aria-label={t('adminTeams.filters.label')}>
            {FILTERS.map((option) => {
              const active = filter === option.filter
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={active}
                  data-active={active}
                  onClick={() => {
                    setFilter(option.filter)
                    setOffset(0)
                  }}
                  className="segmented-item"
                >
                  {t(option.label)}
                  {active && teams.data && (
                    <span className="ml-1.5 text-[10px] tabular-nums text-neutral-500">
                      {total}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-5">
          {teams.isPending ? (
            <Loading label={t('adminTeams.loading')} />
          ) : teams.isError ? (
            <p role="alert" className="text-sm text-danger-700">
              {t('adminTeams.errors.load')}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-neutral-400">
              {q || filter ? t('adminTeams.empty') : t('adminTeams.emptyAll')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead>
                  <tr className="text-xs text-neutral-500">
                    <th scope="col" className="pb-2 pr-3 font-normal">
                      {t('adminTeams.columns.team')}
                    </th>
                    <th scope="col" className="pb-2 pr-3 font-normal">
                      {t('adminTeams.columns.created')}
                    </th>
                    <th scope="col" className="pb-2 pr-3 text-right font-normal">
                      {t('adminTeams.columns.members')}
                    </th>
                    <th scope="col" className="pb-2 pr-3 font-normal">
                      {t('adminTeams.columns.admins')}
                    </th>
                    <th scope="col" className="pb-2 pr-3 text-right font-normal">
                      {t('adminTeams.columns.tickets')}
                    </th>
                    <th scope="col" className="pb-2 pr-3 font-normal">
                      {t('adminTeams.columns.lastActivity')}
                    </th>
                    <th scope="col" className="pb-2">
                      <span className="sr-only">{t('adminTeams.columns.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900/8">
                  {rows.map((team) => (
                    <TeamRow
                      key={team.id}
                      team={team}
                      onAppoint={() => setAppointing(team)}
                      onArchive={() =>
                        act(
                          () => archive.mutateAsync({ teamId: team.id }),
                          t('adminTeams.errors.archive'),
                        )
                      }
                      onUnarchive={() =>
                        act(
                          () => unarchive.mutateAsync({ teamId: team.id }),
                          t('adminTeams.errors.unarchive'),
                        )
                      }
                      onDelete={() => onDelete(team)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {total > PAGE_SIZE && (
          <div className="hairline mt-4 flex items-center justify-between border-t pt-4">
            <p className="text-xs text-neutral-400">
              {t('adminTeams.range', {
                from: offset + 1,
                to: Math.min(offset + PAGE_SIZE, total),
                total,
              })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="btn btn-ghost btn-sm"
              >
                <Icon name="chevron-left" size={14} />
                {t('adminTeams.previous')}
              </button>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="btn btn-ghost btn-sm"
              >
                {t('adminTeams.next')}
                <Icon name="chevron-right" size={14} />
              </button>
            </div>
          </div>
        )}
      </section>

      {appointing && (
        <AppointDialog
          team={appointing}
          onClose={() => setAppointing(null)}
          onDone={() => void refresh()}
        />
      )}
    </div>
  )
}

/** A team's key, in a colour of its own -- grey once it is archived. */
function TeamKey({ team }: { team: AdminTeamRead }) {
  const color = team.archived_at ? 'var(--color-neutral-400)' : departmentColor(team.id)
  return (
    <span
      className="identifier flex h-7 w-12 shrink-0 items-center justify-center rounded-control text-[11px] font-semibold"
      style={{ color, background: `color-mix(in oklab, ${color} 14%, transparent)` }}
    >
      {team.key}
    </span>
  )
}

function TeamRow({
  team,
  onAppoint,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  team: AdminTeamRead
  onAppoint: () => void
  onArchive: () => void
  onUnarchive: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const archived = Boolean(team.archived_at)
  const admins = team.admins.map((admin) => admin.full_name)
  const muted = archived ? 'text-neutral-400' : 'text-neutral-600'

  return (
    <tr className={archived ? 'text-neutral-400' : ''}>
      <td className="py-3 pr-3">
        <div className="flex items-center gap-3">
          <TeamKey team={team} />
          <span className={`whitespace-nowrap ${archived ? 'text-neutral-500' : 'text-neutral-900'}`}>
            {team.name}
          </span>
          {/* One mark a row, the most pressing: archived, then quiet, then
              how few run it. */}
          {archived ? (
            <span className="chip whitespace-nowrap" style={{ ['--chip' as string]: 'var(--color-neutral-400)' }}>
              <Icon name="lock" size={10} />
              {t('adminTeams.badges.archived')}
            </span>
          ) : team.quiet ? (
            <span className="chip whitespace-nowrap" style={{ ['--chip' as string]: 'var(--color-neutral-400)' }}>
              {t('adminTeams.badges.quiet')}
            </span>
          ) : team.admins.length <= 1 ? (
            <span className="chip whitespace-nowrap" style={{ ['--chip' as string]: 'var(--color-accent-amber)' }}>
              {t(team.admins.length === 1 ? 'adminTeams.badges.oneAdmin' : 'adminTeams.badges.noAdmin')}
            </span>
          ) : null}
        </div>
      </td>
      <td className={`whitespace-nowrap py-3 pr-3 ${muted}`}>
        {formatDate(parseServerDate(team.created_at), t('adminTeams.createdPattern'))}
      </td>
      <td className={`py-3 pr-3 text-right tabular-nums ${archived ? '' : 'text-neutral-800'}`}>
        {team.member_count}
      </td>
      <td className={`py-3 pr-3 ${archived ? '' : 'text-neutral-800'}`}>
        {/* Comma-separated and cut short, as the mockup has it: a long
            list of admins is a row of its own otherwise. */}
        <span className="block max-w-[14rem] truncate" title={admins.join(', ')}>
          {admins.length > 0 ? admins.join(', ') : t('adminTeams.noAdmins')}
        </span>
      </td>
      <td className={`py-3 pr-3 text-right tabular-nums ${archived ? '' : 'text-neutral-800'}`}>
        {team.ticket_count}
      </td>
      <td className={`whitespace-nowrap py-3 pr-3 ${muted}`}>
        {formatRelative(parseServerDate(team.last_activity_at))}
      </td>
      <td className="py-3 text-right">
        <TicketActionsMenu
          compact
          label={t('adminTeams.menu.open', { team: team.name })}
          menuLabel={t('adminTeams.menu.label', { team: team.name })}
          heading={
            <div className="flex items-center gap-2.5 px-2 pb-2 pt-1.5">
              <TeamKey team={team} />
              <span className="text-sm font-semibold text-neutral-900">{team.name}</span>
            </div>
          }
          actions={[
            { label: t('adminTeams.menu.appoint'), icon: 'users', onSelect: onAppoint },
            archived
              ? { label: t('adminTeams.menu.unarchive'), icon: 'lock', onSelect: onUnarchive }
              : { label: t('adminTeams.menu.archive'), icon: 'lock', onSelect: onArchive },
            {
              label: t('adminTeams.menu.delete'),
              icon: 'trash',
              destructive: true,
              disabled: !team.can_delete,
              hint: team.can_delete ? undefined : t('adminTeams.menu.onlyWhenEmpty'),
              onSelect: onDelete,
            },
          ]}
        />
      </td>
    </tr>
  )
}

/** Appoint an admin, for the team whose only one is away. Somebody on the
 *  team is promoted; anybody else joins it as an admin. */
function AppointDialog({
  team,
  onClose,
  onDone,
}: {
  team: AdminTeamRead
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const dialogRef = useFocusTrap<HTMLDivElement>()
  const titleId = useId()
  const [search, setSearch] = useState('')
  const query = useDebounced(search, 200)
  const [chosen, setChosen] = useState<PersonOption | null>(null)
  const [error, setError] = useState<string | null>(null)
  const members = useListTeamMembersAdminTeamsTeamIdMembersGet(team.id)
  const candidates = useListUsersAdminUsersGet({ q: query || undefined, limit: 8 })
  const appoint = useAppointTeamAdminAdminTeamsTeamIdAdminsPost()

  const adminIds = new Set(team.admins.map((admin) => admin.id))
  const results = (candidates.data?.items ?? []).filter(
    (person) => person.is_active && !person.is_external && !adminIds.has(person.id),
  )
  const role = chosen
    ? (members.data ?? []).find((member) => member.user.id === chosen.id)?.role
    : undefined
  const firstName = chosen?.full_name.split(' ')[0] ?? ''

  const admins = team.admins.map((admin) => admin.full_name)
  const current =
    admins.length === 0
      ? t('adminTeams.appoint.noAdmin')
      : admins.length === 1
        ? t('adminTeams.appoint.onlyAdmin', { name: admins[0] })
        : t('adminTeams.appoint.admins', { names: formatList(admins) })

  const onConfirm = async () => {
    if (!chosen) return
    setError(null)
    try {
      await appoint.mutateAsync({ teamId: team.id, data: { user_id: chosen.id } })
      onDone()
      onClose()
    } catch (err: unknown) {
      setError(errorDetail(err, t('adminTeams.errors.appoint')))
    }
  }

  return (
    <div
      className="scrim fixed inset-0 z-30 flex items-start justify-center px-4 pt-[15vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        className="pop-in glass-strong w-full max-w-md rounded-panel p-5"
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight text-neutral-900">
          {t('adminTeams.appoint.title', { team: team.name })}
        </h2>
        <p className="mt-2 text-sm text-neutral-600">{current}</p>

        <div className="mt-4">
          {/* Seen; the field is named by its own label. */}
          <p aria-hidden="true" className="mb-1.5 text-xs text-neutral-500">
            {t('adminTeams.appoint.who')}
          </p>
          <PersonPicker
            label={t('adminTeams.appoint.who')}
            value={chosen}
            results={results}
            onSearch={setSearch}
            onChange={setChosen}
            noneLabel={t('adminTeams.appoint.choose')}
            placeholder={t('adminTeams.appoint.search')}
            noneOption={false}
          />
        </div>

        {chosen && members.data && (
          <p className="mt-3 flex gap-2 rounded-control border border-neutral-900/8 bg-neutral-900/[0.03] px-3 py-2.5 text-sm text-neutral-700">
            <Icon name="history" size={14} className="mt-0.5 shrink-0 text-neutral-500" />
            {t(
              role === 'guest'
                ? 'adminTeams.appoint.isGuest'
                : role
                  ? 'adminTeams.appoint.isMember'
                  : 'adminTeams.appoint.notMember',
              { name: firstName },
            )}
          </p>
        )}

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            {t('common:cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!chosen || appoint.isPending}
            className="btn btn-primary btn-sm"
          >
            {t('adminTeams.appoint.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
