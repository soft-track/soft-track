import { useCallback, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { useListIssuesTeamsTeamIdIssuesGet } from '@/api/generated/endpoints/issues/issues'
import { useSearchSearchGet } from '@/api/generated/endpoints/search/search'
import type { IssueRead } from '@/api/generated/models'
import { useAuth } from '@/auth/AuthContext'
import { filterIssues, type IssueFilters, NO_FILTERS } from '@/board/filterIssues'
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

export default function BoardPage() {
  const { teamKey, issueNumber } = useParams<{ teamKey: string; issueNumber?: string }>()
  const navigate = useNavigate()
  const { team, isLoading, teams } = useTeamByKey(teamKey)
  const { user } = useAuth()

  const [view, setView] = useState<BoardView>('board')
  const [activeProjectId, setActiveProjectId] = useState<number | 'all'>('all')
  const [filters, setFilters] = useState<IssueFilters>(NO_FILTERS)
  const [search, setSearch] = useState('')
  // The sidebar is a drawer below the `lg` breakpoint.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const overlays = useOverlays()

  const teamData = useTeamData(team)
  const issuesParams = { project_id: activeProjectId === 'all' ? undefined : activeProjectId }
  const issuesQuery = useListIssuesTeamsTeamIdIssuesGet(team?.id ?? 0, issuesParams, {
    query: { enabled: Boolean(team) },
  })
  const changeStatus = useStatusChange(team, issuesParams)

  // Memoised on the query result, not rebuilt each render: `?? []` would be
  // a fresh array every time and defeat the filter memo below it.
  const issues = useMemo(() => issuesQuery.data?.items ?? [], [issuesQuery.data])
  const visibleIssues = useMemo(() => filterIssues(issues, filters), [issues, filters])

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
  const setFilter = <K extends keyof IssueFilters>(key: K, value: IssueFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }))

  const sidebar = (
    <Sidebar
      activeProjectId={activeProjectId}
      onSelectProject={(id) => {
        setActiveProjectId(id)
        setSidebarOpen(false)
      }}
      activeCycleId={filters.cycleId}
      onSelectCycle={(cycleId) => {
        setFilter('cycleId', cycleId)
        setSidebarOpen(false)
      }}
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
            priorityFilter={filters.priority}
            onPriorityFilterChange={(value) => setFilter('priority', value)}
            assigneeFilter={filters.assignee}
            onAssigneeFilterChange={(value) => setFilter('assignee', value)}
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
            ) : issuesQuery.isLoading ? (
              <Loading label="Loading issues…" />
            ) : view === 'reports' ? (
              <ReportsView />
            ) : view === 'board' ? (
              <KanbanBoard
                issues={visibleIssues}
                onStatusChange={changeStatus}
                estimates={teamData.estimates}
              />
            ) : (
              <IssueListView issues={visibleIssues} />
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
      {issueNumber && openIssue && (
        <IssueDetailPanel issueId={openIssue.id} onClose={() => navigate(`/${team.key}`)} />
      )}
    </TeamProvider>
  )
}
