import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useListIssuesTeamsTeamIdIssuesGet } from '@/api/generated/endpoints/issues/issues'
import { useSearchSearchGet } from '@/api/generated/endpoints/search/search'
import type { IssueRead, SavedViewRead } from '@/api/generated/models'
import { useAuth } from '@/auth/AuthContext'
import {
  type BoardFilters,
  fromSearchParams,
  fromViewFilters,
  sameFilters,
  toQueryParams,
  toSearchParams,
} from '@/board/filters'
import { IssueListView } from '@/board/IssueListView'
import { KanbanBoard } from '@/board/KanbanBoard'
import { Sidebar } from '@/board/Sidebar'
import { TopBar } from '@/board/TopBar'
import { useOverlays } from '@/board/useOverlays'
import { useStatusChange } from '@/board/useStatusChange'
import { CycleBanner } from '@/cycles/CycleBanner'
import { NewCycleModal } from '@/cycles/NewCycleModal'
import { ImportJiraModal } from '@/imports/ImportJiraModal'
import { IssueDetailPanel } from '@/issues/IssueDetailPanel'
import { NewIssueModal } from '@/issues/NewIssueModal'
import { CommandPalette } from '@/keyboard/CommandPalette'
import { ShortcutsCheatsheet } from '@/keyboard/ShortcutsCheatsheet'
import { type BoardView, useCommands } from '@/keyboard/useCommands'
import { useGlobalShortcuts } from '@/keyboard/useGlobalShortcuts'
import { ReportsView } from '@/reports/ReportsView'
import { SearchResults } from '@/search/SearchResults'
import { useDebounced } from '@/search/useDebounced'
import { TeamProvider } from '@/team/TeamContext'
import { useTeamData } from '@/team/useTeamData'
import { useTeamByKey } from '@/team/useTeams'
import { Loading } from '@/ui/Loading'
import { SaveViewModal } from '@/views/SaveViewModal'
import { useSavedViews } from '@/views/useSavedViews'

export default function BoardPage() {
  const { teamKey, issueNumber } = useParams<{ teamKey: string; issueNumber?: string }>()
  const navigate = useNavigate()
  const { team, isLoading, teams } = useTeamByKey(teamKey)
  const { user } = useAuth()

  const [view, setView] = useState<BoardView>('board')
  const [search, setSearch] = useState('')
  // The sidebar is a drawer below the `lg` breakpoint.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const overlays = useOverlays()
  const [editingView, setEditingView] = useState<SavedViewRead | null>(null)

  // The URL is the filter state, not a copy of it. That is what makes any
  // board someone is looking at a link they can paste, and it gets working
  // back and forward buttons for free.
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => fromSearchParams(searchParams), [searchParams])
  const setFilters = useCallback(
    (next: BoardFilters) => setSearchParams(toSearchParams(next)),
    [setSearchParams],
  )

  const teamData = useTeamData(team)
  const savedViews = useSavedViews(team?.id ?? 0)

  // Landing on the default view, at most once per mount.
  //
  // A ref rather than state because nothing renders differently for having
  // landed -- it only stops the redirect happening a second time, which
  // matters when somebody clears the filters and the URL goes bare again.
  const urlIsBare = searchParams.toString() === ''
  const hasLanded = useRef(false)
  useEffect(() => {
    if (hasLanded.current) return
    // Arriving with filters already in the URL -- a pasted link, or a reload
    // -- means the question has been asked and the default does not apply.
    if (!urlIsBare) {
      hasLanded.current = true
      return
    }
    if (!team || savedViews.isLoading) return

    hasLanded.current = true
    const landing = savedViews.views.find(
      (candidate) => candidate.id === savedViews.effectiveDefaultId,
    )
    if (landing) {
      setSearchParams(toSearchParams(fromViewFilters(landing.filters)), { replace: true })
    }
  }, [urlIsBare, team, savedViews, setSearchParams])

  // Hold the issue query until the URL cannot still be rewritten from under
  // it. When a team default exists this still costs one superseded request on
  // first load -- the redirect happens in the effect above, after this render
  // -- which is a fair price for not duplicating the precedence rule here.
  const filtersAreSettled = !urlIsBare || !savedViews.isLoading

  const issuesParams = useMemo(() => toQueryParams(filters), [filters])
  const issuesQuery = useListIssuesTeamsTeamIdIssuesGet(team?.id ?? 0, issuesParams, {
    query: { enabled: Boolean(team) && filtersAreSettled },
  })
  const changeStatus = useStatusChange(team, issuesParams)

  // Every filter is applied by the server now, so this page is already what
  // the board should show. Filtering it again here would only ever narrow the
  // page that was loaded, which is the bug that moved filtering server-side.
  const issues = useMemo(() => issuesQuery.data?.items ?? [], [issuesQuery.data])

  // Search runs on the server. The old client-side filter could only see the
  // page that was already loaded, and only matched titles.
  const searchQuery = useDebounced(search.trim(), 250)
  const searchResults = useSearchSearchGet(
    { q: searchQuery || 'x', team_id: team?.id, limit: 50 },
    { query: { enabled: Boolean(team) && searchQuery.length > 0 } },
  )

  const openNewIssue = useCallback(() => overlays.open('newIssue'), [overlays])
  const openShortcuts = useCallback(() => overlays.open('shortcuts'), [overlays])
  const togglePalette = useCallback(() => overlays.toggle('palette'), [overlays])

  useGlobalShortcuts({
    togglePalette,
    closeTop: overlays.closeTop,
    openNewIssue,
    openShortcuts,
    suppressed: overlays.isOpen('palette') || overlays.isOpen('shortcuts'),
  })
  const commands = useCommands({
    view,
    setView,
    team,
    teams,
    user,
    openNewIssue,
    openShortcuts,
  })

  const openIssueFromPalette = useCallback(
    (issue: IssueRead) => navigate(`/${team?.key}/issue/${issue.number}`),
    [navigate, team?.key],
  )

  if (isLoading) {
    return (
      <div className="h-screen">
        <Loading />
      </div>
    )
  }

  if (!team) {
    if (teams.length > 0) return <Navigate to={`/${teams[0].key}`} replace />
    return <Navigate to="/new-team" replace />
  }

  const openIssue = issueNumber ? issues.find((i) => String(i.number) === issueNumber) : undefined
  const selectedCycle = teamData.cycles.find((cycle) => cycle.id === filters.cycleId) ?? null
  const isTeamAdmin =
    teamData.members.find((member) => member.user.id === user?.id)?.role === 'admin'
  // Nothing to save while these filters are already a view somebody named.
  const matchesSavedView = savedViews.views.some((candidate) =>
    sameFilters(filters, fromViewFilters(candidate.filters)),
  )

  const sidebar = (
    <Sidebar
      filters={filters}
      onFiltersChange={(next) => {
        setFilters(next)
        setSidebarOpen(false)
      }}
      onEditView={(target) => {
        setSidebarOpen(false)
        setEditingView(target)
        overlays.open('saveView')
      }}
      isAdmin={isTeamAdmin}
      onNewCycle={() => {
        setSidebarOpen(false)
        overlays.open('newCycle')
      }}
      onImport={() => {
        setSidebarOpen(false)
        overlays.open('import')
      }}
    />
  )

  return (
    <TeamProvider value={{ team, teams, ...teamData }}>
      <div className="flex h-screen gap-3 p-2 sm:p-3">
        <div className="hidden h-full lg:block">{sidebar}</div>

        {sidebarOpen && (
          <div
            className="scrim fixed inset-0 z-30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <div
              className="slide-in-left h-full w-72 max-w-[85vw] p-2 sm:p-3"
              onClick={(e) => e.stopPropagation()}
            >
              {sidebar}
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <TopBar
            view={view}
            onViewChange={setView}
            onNewIssue={openNewIssue}
            onOpenSidebar={() => setSidebarOpen(true)}
            search={search}
            onSearchChange={setSearch}
            filters={filters}
            onFiltersChange={setFilters}
            onSaveView={() => {
              setEditingView(null)
              overlays.open('saveView')
            }}
            canSaveView={!matchesSavedView}
            notificationsOpen={overlays.isOpen('notifications')}
            onToggleNotifications={() => overlays.toggle('notifications')}
            onCloseNotifications={() => overlays.close('notifications')}
          />
          {selectedCycle && !searchQuery && <CycleBanner cycle={selectedCycle} />}
          <div className="min-h-0 flex-1">
            {searchQuery ? (
              <SearchResults
                query={searchQuery}
                hits={searchResults.data?.items ?? []}
                total={searchResults.data?.total ?? 0}
                isLoading={searchResults.isLoading}
              />
            ) : !filtersAreSettled || issuesQuery.isLoading ? (
              <Loading label="Loading issues…" />
            ) : view === 'reports' ? (
              <ReportsView />
            ) : view === 'board' ? (
              <KanbanBoard
                issues={issues}
                onStatusChange={changeStatus}
                estimates={teamData.estimates}
              />
            ) : (
              <IssueListView issues={issues} />
            )}
          </div>
        </div>
      </div>

      {overlays.isOpen('palette') && (
        <CommandPalette
          onClose={() => overlays.close('palette')}
          commands={commands}
          issues={issues}
          onOpenIssue={openIssueFromPalette}
        />
      )}
      {overlays.isOpen('shortcuts') && (
        <ShortcutsCheatsheet onClose={() => overlays.close('shortcuts')} />
      )}
      {overlays.isOpen('newIssue') && <NewIssueModal onClose={() => overlays.close('newIssue')} />}
      {overlays.isOpen('newCycle') && <NewCycleModal onClose={() => overlays.close('newCycle')} />}
      {overlays.isOpen('import') && <ImportJiraModal onClose={() => overlays.close('import')} />}
      {overlays.isOpen('saveView') && (
        <SaveViewModal
          filters={editingView ? fromViewFilters(editingView.filters) : filters}
          editing={editingView ?? undefined}
          onClose={() => {
            overlays.close('saveView')
            setEditingView(null)
          }}
        />
      )}
      {issueNumber && openIssue && (
        <IssueDetailPanel issueId={openIssue.id} onClose={() => navigate(`/${team.key}`)} />
      )}
    </TeamProvider>
  )
}
