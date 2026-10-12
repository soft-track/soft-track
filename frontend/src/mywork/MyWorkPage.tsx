import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useCallback, useState } from 'react'
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'

import { getMyWorkMeWorkGet } from '@/api/generated/endpoints/my-work/my-work'
import {
  useAcceptInviteInvitesTokenAcceptPost,
  useDeclineInviteInvitesTokenDeclinePost,
} from '@/api/generated/endpoints/invites/invites'
import type {
  LastActivity,
  MyWorkGrouping,
  MyWorkRead,
  MyWorkTab,
  MyWorkTeam,
  MyWorkTicket,
  WaitingOnMe,
} from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import { useOverlays } from '@/board/useOverlays'
import { useTranslation } from '@/i18n'
import { formatRelative } from '@/i18n/format'
import { parseServerDate } from '@/api/dates'
import { CommandPalette } from '@/keyboard/CommandPalette'
import { ShortcutsCheatsheet } from '@/keyboard/ShortcutsCheatsheet'
import { useCommands } from '@/keyboard/useCommands'
import { useGlobalShortcuts } from '@/keyboard/useGlobalShortcuts'
import { LIST_PAGE, MY_WORK_KEY, myWorkParams, useMyWork } from '@/mywork/useMyWork'
import type { PeopleOutlet } from '@/people/PeopleLayout'
import { DueBadge } from '@/tickets/DueBadge'
import { EstimateBadge } from '@/tickets/EstimateBadge'
import { NewTicketModal } from '@/tickets/NewTicketModal'
import { PriorityIcon } from '@/tickets/PriorityIcon'
import { ProjectBadge } from '@/tickets/TicketCard'
import { TicketTypeIcon } from '@/tickets/TicketTypeIcon'
import { ticketPath } from '@/tickets/surface'
import { canWriteIn } from '@/team/members'
import { useTeamContext } from '@/team/useTeamContext'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'
import { Select } from '@/ui/Select'

const TABS: MyWorkTab[] = ['assigned', 'watching', 'created']

function tabFrom(value: string | null): MyWorkTab {
  return TABS.find((tab) => tab === value) ?? 'assigned'
}

function groupingFrom(value: string | null): MyWorkGrouping {
  return value === 'none' ? 'none' : 'team'
}

/**
 * /my-work (#258): what is mine to do, across every team I am on.
 *
 * Where signing in lands. Assigned to me, the tickets I watch and the ones I
 * created, as tabs; by team, each with its totals from the database, or as
 * one list. What is overdue or due in the next three days is pulled to the
 * top of Assigned to me whatever the grouping. Beside it, what waits on me:
 * invitations, and requests to join the teams I run.
 *
 * The tab and the grouping are in the address, so Back from a ticket returns
 * to the same list. A row is a link to the ticket's page: there is no board
 * here for a panel to open over.
 */
export default function MyWorkPage() {
  const { t } = useTranslation('mywork')
  const { openSidebar } = useOutletContext<PeopleOutlet>()
  const [params, setParams] = useSearchParams()
  const tab = tabFrom(params.get('tab'))
  const grouping = groupingFrom(params.get('group'))
  const work = useMyWork(tab, grouping)
  const { user } = useAuth()
  const { team, teams, members } = useTeamContext()
  const navigate = useNavigate()

  const overlays = useOverlays()
  const canWrite = canWriteIn(members, user?.id)
  const openNewTicketNow = useCallback(() => overlays.open('newTicket'), [overlays])
  const openNewTicket = canWrite ? openNewTicketNow : undefined
  const openShortcuts = useCallback(() => overlays.open('shortcuts'), [overlays])
  const togglePalette = useCallback(() => overlays.toggle('palette'), [overlays])
  useGlobalShortcuts({
    togglePalette,
    closeTop: overlays.closeTop,
    openNewTicket,
    openShortcuts,
    suppressed: overlays.isOpen('palette') || overlays.isOpen('shortcuts'),
  })
  // Every team's board, the current one included: nothing here is a board.
  const commands = useCommands({ team: undefined, teams, user, openNewTicket, openShortcuts })

  const choose = (next: { tab?: MyWorkTab; grouping?: MyWorkGrouping }) => {
    const search = new URLSearchParams(params)
    const nextTab = next.tab ?? tab
    const nextGrouping = next.grouping ?? grouping
    if (nextTab === 'assigned') search.delete('tab')
    else search.set('tab', nextTab)
    if (nextGrouping === 'team') search.delete('group')
    else search.set('group', nextGrouping)
    setParams(search, { replace: true })
  }

  const counts = work.data?.counts

  return (
    <>
      <header className="glass flex flex-wrap items-center gap-2 rounded-panel px-3 py-2">
        <button
          type="button"
          onClick={openSidebar}
          className="btn btn-ghost btn-icon btn-sm lg:hidden"
          aria-label={t('openNavigation')}
        >
          <Icon name="menu" size={16} />
        </button>
        <h1 className="mr-1 text-sm font-semibold tracking-tight text-neutral-900">{t('title')}</h1>
        <div className="segmented" role="tablist" aria-label={t('tabsLabel')}>
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              data-active={tab === item}
              onClick={() => choose({ tab: item })}
              className="segmented-item"
            >
              {t(`tabs.${item}`)}
              {counts && (
                <span className="identifier text-[10px] text-neutral-400">{counts[item]}</span>
              )}
            </button>
          ))}
        </div>
        <Select
          dense
          value={grouping}
          onChange={(e) => choose({ grouping: e.target.value as MyWorkGrouping })}
          aria-label={t('grouping.label')}
        >
          <option value="team">{t('grouping.team')}</option>
          <option value="none">{t('grouping.none')}</option>
        </Select>
        <div className="flex-1" />
        {openNewTicket && (
          <button type="button" onClick={openNewTicket} className="btn btn-primary btn-sm">
            <Icon name="plus" size={14} />
            {t('newTicket')}
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto lg:flex-row lg:overflow-visible">
        <section
          aria-label={t(`tabs.${tab}`)}
          className="glass scroll-thin min-w-0 flex-1 rounded-panel lg:overflow-y-auto"
        >
          {work.isPending ? (
            <div className="py-16">
              <Loading />
            </div>
          ) : work.isError || !work.data ? (
            <div className="flex flex-col items-center gap-2 py-16 text-sm text-neutral-500">
              {t('error')}
              <button type="button" onClick={() => work.refetch()} className="btn btn-secondary btn-sm">
                {t('retry')}
              </button>
            </div>
          ) : (
            <WorkList key={`${tab}:${grouping}`} work={work.data} />
          )}
        </section>

        <aside className="glass scroll-thin shrink-0 rounded-panel p-4 lg:w-80 lg:overflow-y-auto">
          <WaitingPanel waiting={work.data?.waiting} />
        </aside>
      </div>

      {overlays.isOpen('palette') && (
        <CommandPalette
          onClose={() => overlays.close('palette')}
          commands={commands}
          tickets={[]}
          onOpenTicket={(ticket) => navigate(ticketPath(ticket))}
        />
      )}
      {overlays.isOpen('shortcuts') && (
        <ShortcutsCheatsheet onClose={() => overlays.close('shortcuts')} />
      )}
      {overlays.isOpen('newTicket') && team && (
        <NewTicketModal onClose={() => overlays.close('newTicket')} />
      )}
    </>
  )
}

/** The tickets: due soon on top, then the groups or the one list. */
function WorkList({ work }: { work: MyWorkRead }) {
  const { t } = useTranslation('mywork')
  const [more, setMore] = useState<Record<string, MyWorkTicket[]>>({})
  const [loading, setLoading] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const showTeam = work.grouping === 'none'

  const groups = work.teams.map((group) => {
    const tickets = [...group.tickets, ...(more[group.team.id] ?? [])]
    return { group, tickets, left: group.listed_count - tickets.length }
  })
  const list = work.tickets
  const listed = list ? [...list.items, ...(more.list ?? [])] : []
  const listLeft = list ? list.total - listed.length : 0

  const load = async (key: string, fetch: () => Promise<MyWorkTicket[]>) => {
    setLoading(key)
    setFailed(false)
    try {
      const rows = await fetch()
      setMore((shown) => ({ ...shown, [key]: [...(shown[key] ?? []), ...rows] }))
    } catch {
      setFailed(true)
    } finally {
      setLoading(null)
    }
  }
  const base = myWorkParams(work.tab, work.grouping)
  const moreOf = (group: MyWorkTeam, offset: number) =>
    load(String(group.team.id), async () => {
      const page = await getMyWorkMeWorkGet({
        ...base,
        team_id: group.team.id,
        offset,
        per_team: 20,
      })
      return page.teams[0]?.tickets ?? []
    })
  const moreOfList = () =>
    load('list', async () => {
      const page = await getMyWorkMeWorkGet({ ...base, offset: listed.length, limit: LIST_PAGE })
      return page.tickets?.items ?? []
    })

  const nothing =
    work.due.length === 0 && groups.length === 0 && (list ? list.total === 0 : true)
  if (nothing) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Icon name="check" size={26} className="text-neutral-300" />
        <p className="text-sm text-neutral-800">{t(`empty.${work.tab}`)}</p>
        <p className="text-xs text-neutral-400">{t('empty.hint')}</p>
      </div>
    )
  }

  const footer = list
    ? listLeft > 0 && (
        <button
          type="button"
          onClick={moreOfList}
          disabled={loading !== null}
          className="text-xs font-medium text-neutral-500 hover:text-brand-600 hover:underline disabled:opacity-60"
        >
          {t('showMore', { count: listLeft })}
        </button>
      )
    : groups
        .filter(({ left }) => left > 0)
        .map(({ group, tickets, left }, index) => (
          <span key={group.team.id}>
            {index > 0 && <span className="text-neutral-400"> · </span>}
            <button
              type="button"
              onClick={() => moreOf(group, tickets.length)}
              disabled={loading !== null}
              className="text-xs font-medium text-neutral-500 hover:text-brand-600 hover:underline disabled:opacity-60"
            >
              {t('showMoreIn', { count: left, team: group.team.name })}
            </button>
          </span>
        ))

  return (
    <div className="pb-2">
      {work.due.length > 0 && (
        <section aria-labelledby="my-work-due">
          <GroupHeading id="my-work-due" title={t('due')} meta={String(work.due.length)} />
          <ul className="divide-y divide-neutral-900/8">
            {work.due.map((ticket) => (
              <WorkRow key={ticket.id} ticket={ticket} />
            ))}
          </ul>
        </section>
      )}
      {groups.map(({ group, tickets }) => (
        <section key={group.team.id} aria-labelledby={`my-work-team-${group.team.id}`}>
          <GroupHeading
            id={`my-work-team-${group.team.id}`}
            title={
              <>
                <Link to={`/${group.team.key}`} className="hover:underline">
                  {group.team.name}
                </Link>
                {' · '}
                {group.team.key}
              </>
            }
            meta={t('teamTotals', { count: group.open_count, points: group.points })}
          />
          <ul className="divide-y divide-neutral-900/8">
            {tickets.map((ticket) => (
              <WorkRow key={ticket.id} ticket={ticket} />
            ))}
          </ul>
        </section>
      ))}
      {list && listed.length > 0 && (
        <ul className={`divide-y divide-neutral-900/8 ${work.due.length > 0 ? 'hairline border-t' : ''}`}>
          {listed.map((ticket) => (
            <WorkRow key={ticket.id} ticket={ticket} showTeam={showTeam} />
          ))}
        </ul>
      )}
      {(failed || (Array.isArray(footer) ? footer.length > 0 : footer)) && (
        <div className="hairline border-t px-5 py-3">
          {failed && <p className="mb-1 text-xs text-danger-600">{t('moreError')}</p>}
          {footer}
        </div>
      )}
    </div>
  )
}

function GroupHeading({
  id,
  title,
  meta,
}: {
  id: string
  title: ReactNode
  meta: string
}) {
  return (
    <h2
      id={id}
      className="hairline flex items-baseline gap-2 border-b px-5 pb-2 pt-4 first:pt-3"
    >
      <span className="eyebrow">{title}</span>
      <span className="identifier text-[11px] font-normal text-neutral-400">{meta}</span>
    </h2>
  )
}

/** One ticket, as a row on the list view shows it, and a link to its page. */
function WorkRow({ ticket, showTeam = false }: { ticket: MyWorkTicket; showTeam?: boolean }) {
  return (
    <li>
      <Link
        to={ticketPath(ticket)}
        className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm transition-colors hover:bg-neutral-900/4 focus:outline-none focus-visible:bg-brand-500/10"
      >
        <PriorityIcon priority={ticket.priority} />
        <TicketTypeIcon type={ticket.type} />
        <span className="identifier w-16 shrink-0 text-xs font-medium text-neutral-400">
          {ticket.identifier}
        </span>
        <span
          className="dot"
          style={{ ['--dot' as string]: ticket.status.color }}
          title={ticket.status.name}
        />
        <span className="min-w-0 flex-1 truncate font-medium text-neutral-900">{ticket.title}</span>
        {ticket.last_activity ? (
          <Activity activity={ticket.last_activity} />
        ) : (
          !showTeam && (
            <>
              {ticket.project && (
                <span className="hidden shrink-0 sm:flex">
                  <ProjectBadge name={ticket.project.name} color={ticket.project.color} />
                </span>
              )}
              {ticket.due_date && <DueBadge dueDate={ticket.due_date} resolved={false} />}
            </>
          )
        )}
        {ticket.estimate != null && <EstimateBadge points={ticket.estimate} />}
      </Link>
    </li>
  )
}

/** What last happened on a watched ticket: "commented 2h ago", "assigned to Daniel". */
function Activity({ activity }: { activity: LastActivity }) {
  const { t } = useTranslation('mywork')
  const when = formatRelative(parseServerDate(activity.at))
  let what: string
  if (activity.kind === 'created') what = t('activity.created', { when })
  else if (activity.kind === 'commented') what = t('activity.commented', { when })
  else if (activity.field === 'assignee')
    what = activity.new_label
      ? t('activity.assigned', { name: activity.new_label.split(' ')[0] })
      : t('activity.unassigned')
  else what = t(`activity.changed.${activity.field ?? 'status'}`)
  const named = activity.actor ? `${what} · ${activity.actor.full_name}` : what
  return (
    <span
      className="hidden shrink-0 truncate text-xs text-neutral-500 sm:inline"
      title={t('activity.title', { what: named, when })}
    >
      {what}
    </span>
  )
}

/** Invitations to me, and requests to join the teams I run. */
function WaitingPanel({ waiting }: { waiting: WaitingOnMe | undefined }) {
  const { t } = useTranslation('mywork')
  const accept = useAcceptInviteInvitesTokenAcceptPost()
  const decline = useDeclineInviteInvitesTokenDeclinePost()
  const queryClient = useQueryClient()

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [MY_WORK_KEY] }),
      queryClient.invalidateQueries({ queryKey: ['/auth/me/invites'] }),
      queryClient.invalidateQueries({ queryKey: ['/teams'], refetchType: 'all' }),
    ])
  const answer = async (token: string, yes: boolean) => {
    await (yes ? accept : decline).mutateAsync({ token })
    await refresh()
  }

  const invites = waiting?.invites ?? []
  const requests = waiting?.join_requests ?? []

  return (
    <>
      <h2 className="eyebrow">{t('waiting.heading')}</h2>
      {waiting && invites.length === 0 && requests.length === 0 && (
        <p className="mt-3 text-sm text-neutral-500">{t('waiting.nothing')}</p>
      )}
      <ul className="divide-y divide-neutral-900/8">
        {invites.map((invite) => (
          <li key={`invite-${invite.id}`} className="flex gap-3 py-3">
            <Avatar user={invite.invited_by} size={30} decorative />
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-neutral-800">
                {t('waiting.invited', {
                  inviter: invite.invited_by.full_name,
                  team: invite.team_name,
                  role: t(`waiting.roles.${invite.role}`),
                })}
              </p>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => answer(invite.token, true)}
                  disabled={accept.isPending || decline.isPending}
                  className="btn btn-secondary btn-sm"
                >
                  {t('waiting.accept')}
                </button>
                <button
                  type="button"
                  onClick={() => answer(invite.token, false)}
                  disabled={accept.isPending || decline.isPending}
                  className="btn btn-ghost btn-sm"
                >
                  {t('waiting.decline')}
                </button>
              </div>
            </div>
          </li>
        ))}
        {requests.map((request) => (
          <li key={`request-${request.id}`} className="flex gap-3 py-3">
            <Avatar user={request.requester} size={30} decorative />
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-neutral-800">
                {t('waiting.asked', {
                  name: request.requester.full_name,
                  team: request.team.name,
                })}
              </p>
              {/* Decided where a team's requests always are: its members. */}
              <Link
                to={`/settings/teams/${request.team.key}/members`}
                className="btn btn-secondary btn-sm mt-2"
              >
                {t('waiting.decide')}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
