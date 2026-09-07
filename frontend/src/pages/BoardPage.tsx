import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import {
  getListIssuesTeamsTeamIdIssuesGetQueryKey,
  useListIssuesTeamsTeamIdIssuesGet,
  useUpdateIssueIssuesIssueIdPatch,
} from '../api/generated/endpoints/issues/issues'
import { useListLabelsTeamsTeamIdLabelsGet } from '../api/generated/endpoints/labels/labels'
import { useListProjectsTeamsTeamIdProjectsGet } from '../api/generated/endpoints/projects/projects'
import { useGetEstimateSummaryTeamsTeamIdEstimatesGet } from '../api/generated/endpoints/issues/issues'
import { useSearchSearchGet } from '../api/generated/endpoints/search/search'
import { useListTeamMembersTeamsTeamIdMembersGet } from '../api/generated/endpoints/teams/teams'
import type { IssuePriority, IssueRead, IssueStatus } from '../api/generated/models'
import { IssueDetailPanel } from '../components/IssueDetailPanel'
import { IssueListView } from '../components/IssueListView'
import { KanbanBoard } from '../components/KanbanBoard'
import { CycleBanner } from '../components/CycleBanner'
import { NewCycleModal } from '../components/NewCycleModal'
import { SearchResults } from '../components/SearchResults'
import { ReportsView } from '../reports/ReportsView'
import { useListCyclesTeamsTeamIdCyclesGet } from '../api/generated/endpoints/cycles/cycles'
import { CommandPalette, type Command } from '../keyboard/CommandPalette'
import { ShortcutsCheatsheet } from '../keyboard/ShortcutsCheatsheet'
import { isPlainKey, isTypingTarget } from '../keyboard/typing'
import { NewIssueModal } from '../components/NewIssueModal'
import { Sidebar } from '../components/Sidebar'
import { TopBar, type AssigneeFilter } from '../components/TopBar'
import { useTeamByKey } from '../lib/useTeams'
import { TeamProvider } from '../team/TeamContext'

export default function BoardPage() {
  const { teamKey, issueNumber } = useParams<{ teamKey: string; issueNumber?: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { team, isLoading, teams } = useTeamByKey(teamKey)

  const [activeProjectId, setActiveProjectId] = useState<number | 'all'>('all')
  const [activeCycleId, setActiveCycleId] = useState<number | null>(null)
  const [showNewCycle, setShowNewCycle] = useState(false)
  const [view, setView] = useState<'board' | 'list' | 'reports'>('board')
  const [search, setSearch] = useState('')
  const [showNewIssue, setShowNewIssue] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState<IssuePriority | 'all'>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>('all')

  const projectsQuery = useListProjectsTeamsTeamIdProjectsGet(team?.id ?? 0, {
    query: { enabled: Boolean(team) },
  })
  const labelsQuery = useListLabelsTeamsTeamIdLabelsGet(team?.id ?? 0, {
    query: { enabled: Boolean(team) },
  })
  const membersQuery = useListTeamMembersTeamsTeamIdMembersGet(team?.id ?? 0, {
    query: { enabled: Boolean(team) },
  })
  const cyclesQuery = useListCyclesTeamsTeamIdCyclesGet(team?.id ?? 0, {
    query: { enabled: Boolean(team) },
  })
  const issuesParams = { project_id: activeProjectId === 'all' ? undefined : activeProjectId }
  // Rolled up on the server rather than summed from `issues` below: that
  // list is one page, so a client-side total would be the total of whatever
  // happened to be loaded.
  const estimatesQuery = useGetEstimateSummaryTeamsTeamIdEstimatesGet(team?.id ?? 0, {
    query: { enabled: Boolean(team) },
  })

  const issuesQuery = useListIssuesTeamsTeamIdIssuesGet(team?.id ?? 0, issuesParams, {
    query: { enabled: Boolean(team) },
  })
  const updateIssue = useUpdateIssueIssuesIssueIdPatch()

  const filteredIssues = useMemo(() => {
    let issues = issuesQuery.data?.items ?? []

    if (priorityFilter !== 'all') {
      issues = issues.filter((issue) => issue.priority === priorityFilter)
    }
    if (activeCycleId !== null) {
      issues = issues.filter((issue) => issue.cycle_id === activeCycleId)
    }
    if (assigneeFilter === 'unassigned') {
      issues = issues.filter((issue) => !issue.assignee)
    } else if (assigneeFilter !== 'all') {
      issues = issues.filter((issue) => issue.assignee?.id === assigneeFilter)
    }
    return issues
  }, [issuesQuery.data, priorityFilter, assigneeFilter, activeCycleId])

  // Search runs on the server. The old client-side filter could only see the
  // page that was already loaded, and only matched titles.
  const searchQuery = useDebounced(search.trim(), 250)
  const searchResults = useSearchSearchGet(
    { q: searchQuery || 'x', team_id: team?.id, limit: 50 },
    { query: { enabled: Boolean(team) && searchQuery.length > 0 } },
  )

  const openIssue = issueNumber
    ? issuesQuery.data?.items.find((i) => String(i.number) === issueNumber)
    : undefined

  const handleStatusChange = async (issueId: number, status: IssueStatus) => {
    if (!team) return
    const queryKey = getListIssuesTeamsTeamIdIssuesGetQueryKey(team.id, issuesParams)
    const previous = queryClient.getQueryData<IssueRead[]>(queryKey)
    queryClient.setQueryData<IssueRead[]>(
      queryKey,
      (old) => old?.map((issue) => (issue.id === issueId ? { ...issue, status } : issue)) ?? old,
    )
    try {
      await updateIssue.mutateAsync({ issueId, data: { status } })
      queryClient.invalidateQueries({ queryKey: [`/issues/${issueId}`] })
      // Moving a card moves its points between columns.
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/estimates`] })
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/cycles`] })
    } catch {
      queryClient.setQueryData(queryKey, previous)
    }
  }

  /**
   * Global shortcuts.
   *
   * Every single-key binding is gated on `isTypingTarget` first. Without that
   * guard, typing an issue title containing "c" fires "create issue" -- which
   * is how keyboard shortcuts get added and then quietly turned off again.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setShowPalette((open) => !open)
        return
      }

      if (event.key === 'Escape') {
        // Close the shallowest thing that is open, so Escape never skips a
        // layer or closes two at once.
        if (showPalette) setShowPalette(false)
        else if (showShortcuts) setShowShortcuts(false)
        else if (showNewIssue) setShowNewIssue(false)
        return
      }

      if (!isPlainKey(event) || isTypingTarget(event.target)) return
      if (showPalette || showShortcuts) return

      if (event.key === 'c') {
        event.preventDefault()
        setShowNewIssue(true)
      } else if (event.key === '?') {
        event.preventDefault()
        setShowShortcuts(true)
      } else if (event.key === '/') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('input[type="search"], input[placeholder*="Search"]')?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showPalette, showShortcuts, showNewIssue])

  const openIssueFromPalette = useCallback(
    (issue: IssueRead) => navigate(`/${team?.key}/issue/${issue.number}`),
    [navigate, team?.key],
  )

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: 'new-issue',
        label: 'Create an issue',
        hint: 'C',
        group: 'Actions',
        run: () => setShowNewIssue(true),
      },
      {
        id: 'toggle-view',
        label: view === 'board' ? 'Switch to list view' : 'Switch to board view',
        group: 'Actions',
        run: () => setView(view === 'board' ? 'list' : 'board'),
      },
      {
        id: 'shortcuts',
        label: 'Show keyboard shortcuts',
        hint: '?',
        group: 'Actions',
        run: () => setShowShortcuts(true),
      },
    ]

    for (const candidate of teams) {
      if (candidate.id === team?.id) continue
      list.push({
        id: `team-${candidate.id}`,
        label: `Switch to ${candidate.name}`,
        hint: candidate.key,
        group: 'Teams',
        run: () => navigate(`/${candidate.key}`),
      })
    }

    return list
  }, [view, teams, team?.id, navigate])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-neutral-400">
        Loading…
      </div>
    )
  }

  if (!team) {
    if (teams.length > 0) return <Navigate to={`/${teams[0].key}`} replace />
    return <Navigate to="/new-team" replace />
  }

  const selectedCycle =
    (cyclesQuery.data ?? []).find((cycle) => cycle.id === activeCycleId) ?? null

  const closeIssue = () => navigate(`/${team.key}`)

  return (
    <TeamProvider
      value={{
        team,
        teams,
        projects: projectsQuery.data ?? [],
        labels: labelsQuery.data ?? [],
        members: membersQuery.data ?? [],
        cycles: cyclesQuery.data ?? [],
      }}
    >
      <div className="flex h-screen bg-neutral-50">
        <Sidebar
          activeProjectId={activeProjectId}
          onSelectProject={setActiveProjectId}
          activeCycleId={activeCycleId}
          onSelectCycle={setActiveCycleId}
          onNewCycle={() => setShowNewCycle(true)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            view={view}
            onViewChange={setView}
            onNewIssue={() => setShowNewIssue(true)}
            search={search}
            onSearchChange={setSearch}
            priorityFilter={priorityFilter}
            onPriorityFilterChange={setPriorityFilter}
            assigneeFilter={assigneeFilter}
            onAssigneeFilterChange={setAssigneeFilter}
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
              <div className="flex h-full items-center justify-center text-sm text-neutral-400">
                Loading issues…
              </div>
            ) : view === 'reports' ? (
              <ReportsView />
            ) : view === 'board' ? (
              <KanbanBoard
                issues={filteredIssues}
                onStatusChange={handleStatusChange}
                estimates={estimatesQuery.data}
              />
            ) : (
              <IssueListView issues={filteredIssues} />
            )}
          </div>
        </div>
      </div>

      {showPalette && (
        <CommandPalette
          onClose={() => setShowPalette(false)}
          commands={commands}
          issues={issuesQuery.data?.items ?? []}
          onOpenIssue={openIssueFromPalette}
        />
      )}
      {showShortcuts && <ShortcutsCheatsheet onClose={() => setShowShortcuts(false)} />}

      {showNewIssue && <NewIssueModal onClose={() => setShowNewIssue(false)} />}
      {showNewCycle && <NewCycleModal onClose={() => setShowNewCycle(false)} />}
      {issueNumber && openIssue && (
        <IssueDetailPanel issueId={openIssue.id} onClose={closeIssue} />
      )}
    </TeamProvider>
  )
}


/**
 * Hold a value back until it stops changing.
 *
 * Search hits the database, so firing on every keystroke would send a request
 * per character and race the responses back out of order.
 */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return settled
}
