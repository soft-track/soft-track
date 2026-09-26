import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  useGetIssueByNumberTeamsTeamIdIssuesByNumberNumberGet,
  useGetIssueIssuesIssueIdGet,
} from '@/api/generated/endpoints/issues/issues'
import type { IssueRead, TeamRead } from '@/api/generated/models'
import { errorDetail } from '@/api/errors'
import { useTranslation } from '@/i18n'
import { useIssueShortcuts } from '@/issues/detail/useIssueShortcuts'
import { IssueDetailBody } from '@/issues/IssueDetailBody'
import { IssueHeaderActions } from '@/issues/IssueHeaderActions'
import { IssueSurfaceContext, issuePath } from '@/issues/surface'
import { useTeamEvents } from '@/realtime/useTeamEvents'
import { TeamProvider } from '@/team/TeamContext'
import { useTeamData } from '@/team/useTeamData'
import { useTeamByKey } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

/** A 404 is an answer, not a failure: asking again will not make the issue exist. */
const retryUnlessMissing = (failures: number, error: unknown) =>
  failures < 1 && (error as { response?: { status?: number } })?.response?.status !== 404

/**
 * An issue on a page of its own (#112): what a link from Slack, a search
 * result, the command palette or a notification opens.
 *
 * The same address as the panel on the board, and none of the board: nothing
 * mounts behind it, and the issue is found by its team and number (#111)
 * rather than looked up in a board's list. Page chrome above -- where it
 * sits, a permalink, Watch -- and the shared body below.
 */
export function IssuePage() {
  const { teamKey, issueNumber } = useParams<{ teamKey: string; issueNumber: string }>()
  const { t } = useTranslation(['issues', 'common'])
  const { team, teams, isLoading } = useTeamByKey(teamKey)
  // The team's lists for the properties; not the board's column totals.
  const teamData = useTeamData(team, { estimates: false })
  // Other people's changes arrive as they happen (#103), as on the board.
  useTeamEvents(team?.id)

  const number = Number(issueNumber)
  const valid = Number.isInteger(number) && number > 0
  const found = useGetIssueByNumberTeamsTeamIdIssuesByNumberNumberGet(team?.id ?? 0, number, {
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

  if (!valid || !found.data) {
    const missing =
      !valid || (found.error as { response?: { status?: number } })?.response?.status === 404
    return (
      <Missing
        team={team}
        title={t('page.notFound')}
        body={
          missing
            ? t('page.notFoundBody', { identifier: `${team.key}-${issueNumber}` })
            : errorDetail(found.error, t('page.loadFailed'))
        }
      />
    )
  }

  return (
    <TeamProvider value={{ team, teams, ...teamData }}>
      <IssueSurfaceContext.Provider value="page">
        <IssuePageView found={found.data} team={team} />
      </IssueSurfaceContext.Provider>
    </TeamProvider>
  )
}

function IssuePageView({ found, team }: { found: IssueRead; team: TeamRead }) {
  const { t } = useTranslation(['issues', 'common'])
  // By id from here on: the body reads this same query, and every write it
  // makes refreshes it, so the header keeps up. Seeded with what the lookup
  // by number already returned, so nothing waits on a second request.
  const { data } = useGetIssueIssuesIssueIdGet(found.id, { query: { initialData: found } })
  const issue = data ?? found
  // S, P, A and L, as on the panel. Escape has nothing to close here.
  useIssueShortcuts()

  const documentTitle = t('page.documentTitle', {
    identifier: issue.identifier,
    title: issue.title,
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
            {issue.parent && (
              <li className="hidden min-w-0 items-center gap-1.5 sm:flex">
                <Icon name="chevron-right" size={13} className="shrink-0 text-neutral-300" />
                <Link
                  to={issuePath(issue.parent)}
                  title={t('page.parentTitle', { title: issue.parent.title })}
                  className="identifier rounded-control px-1.5 py-0.5 text-xs font-medium text-neutral-500 transition hover:bg-neutral-900/5 hover:text-neutral-900"
                >
                  {issue.parent.identifier}
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
                style={{ ['--dot' as string]: issue.status.color }}
                title={issue.status.name}
              />
              <span className="identifier text-xs font-semibold text-neutral-700">
                {issue.identifier}
              </span>
              {issue.external_key && (
                <span
                  className="identifier hidden rounded-full bg-neutral-900/6 px-2 py-0.5 text-[10px] text-neutral-500 sm:inline"
                  title={t('panel.importedKey')}
                >
                  {issue.external_key}
                </span>
              )}
            </li>
          </ol>
        </nav>
        <span className="flex shrink-0 items-center gap-1">
          <CopyLinkButton issue={issue} />
          <IssueHeaderActions issue={issue} />
        </span>
      </header>

      <IssueDetailBody issueId={issue.id} />
    </PageFrame>
  )
}

/** The page's permalink: the address it is already at, which is the whole point. */
function CopyLinkButton({ issue }: { issue: IssueRead }) {
  const { t } = useTranslation(['issues', 'common'])
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(new URL(issuePath(issue), window.location.origin).href)
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

/** No team by that key, or no issue by that number on it. */
function Missing({ team, title, body }: { team?: TeamRead; title: string; body: string }) {
  const { t } = useTranslation(['issues', 'common'])
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
