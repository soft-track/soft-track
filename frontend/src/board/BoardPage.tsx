import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useListIssuesTeamsTeamIdIssuesGet } from '@/api/generated/endpoints/issues/issues'
import { useSearchSearchGet } from '@/api/generated/endpoints/search/search'
import type { IssueRead, SavedViewRead } from '@/api/generated/models'
import { useAuth } from '@/auth/useAuth'
import { BulkActionBar } from '@/board/BulkActionBar'
import {
  type BoardFilters,
  fromSearchParams,
  fromViewFilters,
  sameFilters,
  toQueryParams,
  toSearchParams,
} from '@/board/filters'
import { type BoardGrouping, groupingFromSearchParams, withGrouping } from '@/board/grouping'
import {
  type Arrangement,
  type BoardSort,
  fromViewSort,
  sameSort,
  sortFromSearchParams,
  withSort,
} from '@/board/sorting'
import { IssueListView } from '@/board/IssueListView'
import { KanbanBoard } from '@/board/KanbanBoard'
import { EMPTY_SELECTION, selectionReducer } from '@/board/selection'
import { Sidebar } from '@/board/Sidebar'
import { TopBar } from '@/board/TopBar'
import { useBulkEdit } from '@/board/useBulkEdit'
import { useOverlays } from '@/board/useOverlays'
import { useMoveIssue } from '@/board/useMoveIssue'
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
import { isTypingTarget } from '@/keyboard/typing'
import { ProjectPage } from '@/projects/ProjectPage'
import { RoadmapView } from '@/projects/RoadmapView'
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
  const { teamKey, issueNumber, projectId } = useParams<{
    teamKey: string
    issueNumber?: string
    projectId?: string
  }>()
  // A project's own page, in place of the board -- same sidebar, same team.
  const projectPageId = projectId && Number.isInteger(Number(projectId)) ? Number(projectId) : null
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
  const grouping = groupingFromSearchParams(searchParams)
  const sort = sortFromSearchParams(searchParams)
  // The grouping and the sort ride along in the same URL, so changing a
  // filter keeps them and a saved view can set all three at once.
  const writeUrl = useCallback(
    (
      nextFilters: BoardFilters,
      nextGrouping: BoardGrouping,
      nextSort: BoardSort,
      options?: { replace: boolean },
    ) =>
      setSearchParams(
        withSort(withGrouping(toSearchParams(nextFilters), nextGrouping), nextSort),
        options,
      ),
    [setSearchParams],
  )
  /** Undefined leaves the arrangement as it is; a saved view brings its own. */
  const setFilters = useCallback(
    (next: BoardFilters, arrangement?: Arrangement) =>
      writeUrl(next, arrangement?.grouping ?? grouping, arrangement?.sort ?? sort),
    [writeUrl, grouping, sort],
  )
  const setGrouping = useCallback(
    (next: BoardGrouping) => writeUrl(filters, next, sort),
    [writeUrl, filters, sort],
  )
  const setSort = useCallback(
    (next: BoardSort) => writeUrl(filters, grouping, next),
    [writeUrl, filters, grouping],
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
      writeUrl(
        fromViewFilters(landing.filters),
        landing.group_by,
        fromViewSort(landing.sort, landing.sort_direction),
        { replace: true },
      )
    }
  }, [urlIsBare, team, savedViews, writeUrl])

  // Hold the issue query until the URL cannot still be rewritten from under
  // it. When a team default exists this still costs one superseded request on
  // first load -- the redirect happens in the effect above, after this render
  // -- which is a fair price for not duplicating the precedence rule here.
  const filtersAreSettled = !urlIsBare || !savedViews.isLoading

  // The board is in its own hand-arranged order (#88); the list in whatever
  // the viewer sorted it by.
  const order: BoardSort = view === 'board' ? { sort: 'rank', direction: 'asc' } : sort
  const issuesParams = useMemo(
    () => ({ ...toQueryParams(filters), sort: order.sort, direction: order.direction }),
    [filters, order.sort, order.direction],
  )
  const issuesQuery = useListIssuesTeamsTeamIdIssuesGet(team?.id ?? 0, issuesParams, {
    query: { enabled: Boolean(team) && filtersAreSettled && projectPageId === null },
  })
  const changeStatus = useStatusChange(team, issuesParams)
  const moveIssue = useMoveIssue(team, issuesParams)

  // Every filter is applied by the server now, so this page is already what
  // the board should show. Filtering it again here would only ever narrow the
  // page that was loaded, which is the bug that moved filtering server-side.
  const issues = useMemo(() => issuesQuery.data?.items ?? [], [issuesQuery.data])

  const [selection, dispatchSelection] = useReducer(selectionReducer, EMPTY_SELECTION)
  const bulk = useBulkEdit(team)
  const { clearError } = bulk
  const clearSelection = useCallback(() => {
    dispatchSelection({ type: 'clear' })
    clearError()
  }, [clearError])
  const selectIssue = useCallback(
    (id: number, gesture: 'range' | 'toggle', order: readonly number[]) =>
      dispatchSelection(gesture === 'range' ? { type: 'range', id, order } : { type: 'toggle', id }),
    [],
  )
  // A selection only ever holds what is on screen. Changing a filter, or a
  // refetch after somebody else deleted one, drops what went away -- so the
  // bar can never act on an issue nobody can see any more.
  useEffect(() => {
    dispatchSelection({ type: 'retain', visible: issues.map((issue) => issue.id) })
  }, [issues])

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

  // Escape clears the selection, but only once there is nothing above the
  // board for it to close first -- the global handler closes overlays, and an
  // open issue panel has its own.
  const hasSelection = selection.ids.length > 0
  const escapeClearsSelection = hasSelection && overlays.top === null && !issueNumber
  useEffect(() => {
    if (!escapeClearsSelection) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isTypingTarget(event.target)) clearSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [escapeClearsSelection, clearSelection])

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
  // Nothing to save while this board is already a view somebody named.
  const matchesSavedView = savedViews.views.some(
    (candidate) =>
      candidate.group_by === grouping &&
      sameSort(sort, fromViewSort(candidate.sort, candidate.sort_direction)) &&
      sameFilters(filters, fromViewFilters(candidate.filters)),
  )

  const sidebar = (
    <Sidebar
      filters={filters}
      arrangement={{ grouping, sort }}
      onFiltersChange={(next, arrangement) => {
        setFilters(next, arrangement)
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

        {projectPageId !== null ? (
          <div className="min-w-0 flex-1">
            <ProjectPage key={projectPageId} projectId={projectPageId} />
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <TopBar
              view={view}
              onViewChange={setView}
              grouping={grouping}
              onGroupingChange={setGrouping}
              sort={sort}
              onSortChange={setSort}
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
              ) : view === 'roadmap' ? (
                <RoadmapView />
              ) : view === 'reports' ? (
                <ReportsView />
              ) : view === 'board' ? (
                <KanbanBoard
                  issues={issues}
                  grouping={grouping}
                  onStatusChange={changeStatus}
                  onMove={moveIssue}
                  onProjectChange={(ids, projectId) => bulk.update(ids, { project_id: projectId })}
                  estimates={teamData.estimates}
                  selectedIds={selection.ids}
                  onSelect={selectIssue}
                  onBulkStatusChange={(ids, status) => bulk.update(ids, { status_id: status.id })}
                />
              ) : (
                <IssueListView
                  issues={issues}
                  grouping={grouping}
                  selectedIds={selection.ids}
                  onSelect={selectIssue}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {hasSelection &&
        !searchQuery &&
        (view === 'board' || view === 'list') &&
        projectPageId === null && (
        <BulkActionBar selectedIds={selection.ids} bulk={bulk} onClear={clearSelection} />
      )}
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
          grouping={editingView ? editingView.group_by : grouping}
          sort={
            editingView
              ? fromViewSort(editingView.sort, editingView.sort_direction)
              : sort
          }
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
