import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  useGetTicketByNumberTeamsTeamIdTicketsByNumberNumberGet,
  useGetTicketTicketsTicketIdGet,
} from '@/api/generated/endpoints/tickets/tickets'
import type { TicketRead, TeamRead } from '@/api/generated/models'
import { parseServerDate } from '@/api/dates'
import { errorDetail } from '@/api/errors'
import {
  useGetTrashedTicketTeamsTeamIdTrashTicketsNumberGet,
  useRestoreTicketTrashTicketsTicketIdRestorePost,
} from '@/api/generated/endpoints/trash/trash'
import { useAuth } from '@/auth/useAuth'
import { useTranslation } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { TicketDetailBody } from '@/tickets/TicketDetailBody'
import { TicketHeaderActions } from '@/tickets/TicketHeaderActions'
import { TicketStack } from '@/tickets/TicketStack'
import { TicketSurfaceContext, ticketPath } from '@/tickets/surface'
import { useTeamEvents } from '@/realtime/useTeamEvents'
import { canWriteIn } from '@/team/members'
import { TeamProvider } from '@/team/TeamContext'
import { useTeamData } from '@/team/useTeamData'
import { useTeamByKey } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

const statusOf = (error: unknown) => (error as { response?: { status?: number } })?.response?.status

/**
 * A 404 is an answer, not a failure: asking again will not make the ticket
 * exist. Nor will it take one out of the trash (410, #323).
 */
const retryUnlessMissing = (failures: number, error: unknown) =>
  failures < 1 && statusOf(error) !== 404 && statusOf(error) !== 410

/**
 * A ticket on a page of its own (#112): what a link from Slack, a search
 * result, the command palette or a notification opens.
 *
 * The same address as the panel on the board, and none of the board: nothing
 * mounts behind it, and the ticket is found by its team and number (#111)
 * rather than looked up in a board's list. Page chrome above -- where it
 * sits, a permalink, Watch -- and the shared body below.
 */
export function TicketPage() {
  const { teamKey, ticketNumber } = useParams<{ teamKey: string; ticketNumber: string }>()
  const { t } = useTranslation(['tickets', 'common'])
  const { team, teams, isLoading } = useTeamByKey(teamKey)
  const { user } = useAuth()
  // The team's lists for the properties; not the board's column totals.
  const teamData = useTeamData(team, { estimates: false })
  // Other people's changes arrive as they happen (#103), as on the board.
  useTeamEvents(team?.id)

  const number = Number(ticketNumber)
  const valid = Number.isInteger(number) && number > 0
  const found = useGetTicketByNumberTeamsTeamIdTicketsByNumberNumberGet(team?.id ?? 0, number, {
    query: { enabled: Boolean(team) && valid, retry: retryUnlessMissing },
  })

  if (isLoading || found.isLoading) {
    return (
      <PageFrame>
        <Loading label={t('page.loading')} />
      </PageFrame>
    )
  }

  if (!team) return <Missing title={t('page.notFound')} body={t('common:teamNotFound')} />

  if (valid && statusOf(found.error) === 410) {
    return (
      <Deleted
        team={team}
        number={number}
        canRestore={canWriteIn(teamData.members, user?.id)}
        onRestored={() => found.refetch()}
      />
    )
  }

  if (!valid || !found.data) {
    const missing = !valid || statusOf(found.error) === 404
    return (
      <Missing
        team={team}
        title={t('page.notFound')}
        body={
          missing
            ? t('page.notFoundBody', { identifier: `${team.key}-${ticketNumber}` })
            : errorDetail(found.error, t('page.loadFailed'))
        }
      />
    )
  }

  return (
    <TeamProvider value={{ team, teams, ...teamData }}>
      <TicketSurfaceContext.Provider value="page">
        {/* S, P, A and L, as on the panel. A ticket this one links to opens
            in a modal over it (#114), which is all Escape has to close. */}
        <TicketStack ticket={found.data}>
          <TicketPageView found={found.data} team={team} />
        </TicketStack>
      </TicketSurfaceContext.Provider>
    </TeamProvider>
  )
}

function TicketPageView({ found, team }: { found: TicketRead; team: TeamRead }) {
  const { t } = useTranslation(['tickets', 'common'])
  // By id from here on: the body reads this same query, and every write it
  // makes refreshes it, so the header keeps up. Seeded with what the lookup
  // by number already returned, so nothing waits on a second request.
  const { data } = useGetTicketTicketsTicketIdGet(found.id, { query: { initialData: found } })
  const ticket = data ?? found

  const documentTitle = t('page.documentTitle', {
    identifier: ticket.identifier,
    title: ticket.title,
  })
  useEffect(() => {
    const previous = document.title
    document.title = documentTitle
    return () => {
      document.title = previous
    }
  }, [documentTitle])

  return (
    <PageFrame>
      <header className="hairline flex items-center justify-between gap-3 border-b px-3 py-2.5 sm:px-5 sm:py-3">
        <nav aria-label={t('page.breadcrumb')} className="min-w-0">
          <ol className="flex min-w-0 items-center gap-1.5 text-sm">
            <li className="min-w-0">
              <Link
                to={`/${team.key}`}
                aria-label={t('page.backTo', { team: team.name })}
                className="flex min-w-0 items-center gap-1 rounded-control px-1.5 py-0.5 font-medium text-neutral-500 transition hover:bg-neutral-900/5 hover:text-neutral-900"
              >
                {/* On a phone this crumb is the way back. */}
                <Icon name="chevron-left" size={15} className="shrink-0 sm:hidden" />
                <span className="truncate">{team.name}</span>
              </Link>
            </li>
            {ticket.parent && (
              <li className="hidden min-w-0 items-center gap-1.5 sm:flex">
                <Icon name="chevron-right" size={13} className="shrink-0 text-neutral-300" />
                <Link
                  to={ticketPath(ticket.parent)}
                  title={t('page.parentTitle', { title: ticket.parent.title })}
                  className="identifier rounded-control px-1.5 py-0.5 text-xs font-medium text-neutral-500 transition hover:bg-neutral-900/5 hover:text-neutral-900"
                >
                  {ticket.parent.identifier}
                </Link>
              </li>
            )}
            <li aria-current="page" className="flex shrink-0 items-center gap-1.5">
              <Icon
                name="chevron-right"
                size={13}
                className="hidden shrink-0 text-neutral-300 sm:block"
              />
              <span
                className="dot"
                style={{ ['--dot' as string]: ticket.status.color }}
                title={ticket.status.name}
              />
              <span className="identifier text-xs font-semibold text-neutral-700">
                {ticket.identifier}
              </span>
              {ticket.external_key && (
                <span
                  className="identifier hidden rounded-full bg-neutral-900/6 px-2 py-0.5 text-[10px] text-neutral-500 sm:inline"
                  title={t('panel.importedKey')}
                >
                  {ticket.external_key}
                </span>
              )}
            </li>
          </ol>
        </nav>
        <span className="flex shrink-0 items-center gap-1">
          <CopyLinkButton ticket={ticket} />
          <TicketHeaderActions ticket={ticket} />
        </span>
      </header>

      <TicketDetailBody ticketId={ticket.id} />
    </PageFrame>
  )
}

/** The page's permalink: the address it is already at, which is the whole point. */
function CopyLinkButton({ ticket }: { ticket: TicketRead }) {
  const { t } = useTranslation(['tickets', 'common'])
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(new URL(ticketPath(ticket), window.location.origin).href)
      setFailed(false)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Refused outside a secure context, which is where a self-hosted
      // instance often runs. The address bar holds the same link.
      setFailed(true)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={failed ? t('page.clipboardFailed') : t('page.copyLinkHint')}
      className="btn btn-ghost btn-sm text-neutral-500"
    >
      <Icon name={copied ? 'check' : 'link'} size={14} />
      <span className="hidden sm:inline">{copied ? t('common:copied') : t('page.copyLink')}</span>
      {/* Said aloud when it happens; the button's own name stays the action. */}
      <span className="sr-only" role="status">
        {copied ? t('common:copied') : failed ? t('page.clipboardFailed') : ''}
      </span>
    </button>
  )
}

/** The page's frame: the glass sheet over the aurora, with no board behind it. */
function PageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen p-2 sm:p-3">
      <main className="glass-strong mx-auto flex min-h-[calc(100vh-1rem)] w-full max-w-6xl flex-col rounded-panel sm:min-h-[calc(100vh-1.5rem)]">
        {children}
      </main>
    </div>
  )
}

/** No team by that key, or no ticket by that number on it. */
/**
 * A link to a ticket in the trash (#323): not a bare board and not a 404,
 * but who deleted it, when, until when it can come back -- and the way back,
 * for anybody on the team but a guest.
 */
function Deleted({
  team,
  number,
  canRestore,
  onRestored,
}: {
  team: TeamRead
  number: number
  canRestore: boolean
  onRestored: () => void
}) {
  const { t } = useTranslation(['tickets', 'common'])
  const trashed = useGetTrashedTicketTeamsTeamIdTrashTicketsNumberGet(team.id, number)
  const restore = useRestoreTicketTrashTicketsTicketIdRestorePost()
  const [error, setError] = useState<string | null>(null)
  const identifier = `${team.key}-${number}`

  const item = trashed.data
  const body = item
    ? ((item.deleted_by ? 'page.deletedBody' : 'page.deletedBodyNobody') satisfies
        'page.deletedBody' | 'page.deletedBodyNobody')
    : null

  return (
    <PageFrame>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <Icon name="trash" size={20} className="text-neutral-400" />
        <h1 className="text-base font-semibold text-neutral-900">
          {t('page.deleted', { identifier })}
        </h1>
        {item && body && (
          <p className="max-w-sm text-sm text-neutral-500">
            {t(body, {
              name: item.deleted_by?.full_name ?? '',
              on: formatDate(parseServerDate(item.deleted_at), t('page.datePattern')),
              until: formatDate(parseServerDate(item.purge_at), t('page.untilPattern')),
            })}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger-600">
            {error}
          </p>
        )}
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {item && canRestore && (
            <button
              type="button"
              disabled={restore.isPending}
              onClick={async () => {
                setError(null)
                try {
                  await restore.mutateAsync({ ticketId: item.id })
                  onRestored()
                } catch (err: unknown) {
                  setError(errorDetail(err, t('page.restoreFailed')))
                }
              }}
              className="btn btn-secondary btn-sm"
            >
              <Icon name="undo" size={14} />
              {t('page.restore', { identifier })}
            </button>
          )}
          <Link to={`/${team.key}`} className="btn btn-ghost btn-sm">
            <Icon name="chevron-left" size={14} />
            {t('page.backTo', { team: team.name })}
          </Link>
        </div>
      </div>
    </PageFrame>
  )
}

function Missing({ team, title, body }: { team?: TeamRead; title: string; body: string }) {
  const { t } = useTranslation(['tickets', 'common'])
  return (
    <PageFrame>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <h1 className="text-base font-semibold text-neutral-900">{title}</h1>
        <p className="max-w-sm text-sm text-neutral-500">{body}</p>
        <Link to={team ? `/${team.key}` : '/'} className="btn btn-secondary btn-sm mt-3">
          <Icon name="chevron-left" size={14} />
          {team ? t('page.backTo', { team: team.name }) : t('page.home')}
        </Link>
      </div>
    </PageFrame>
  )
}
