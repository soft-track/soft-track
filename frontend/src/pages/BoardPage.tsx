import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import {
  getListIssuesTeamsTeamIdIssuesGetQueryKey,
  useListIssuesTeamsTeamIdIssuesGet,
  useUpdateIssueIssuesIssueIdPatch,
} from '../api/generated/endpoints/issues/issues'
import { useListLabelsTeamsTeamIdLabelsGet } from '../api/generated/endpoints/labels/labels'
import { useListProjectsTeamsTeamIdProjectsGet } from '../api/generated/endpoints/projects/projects'
import { useSearchSearchGet } from '../api/generated/endpoints/search/search'
import { useListTeamMembersTeamsTeamIdMembersGet } from '../api/generated/endpoints/teams/teams'
import type { IssuePriority, IssueRead, IssueStatus } from '../api/generated/models'
import { IssueDetailPanel } from '../components/IssueDetailPanel'
import { IssueListView } from '../components/IssueListView'
import { KanbanBoard } from '../components/KanbanBoard'
import { SearchResults } from '../components/SearchResults'
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
  const [view, setView] = useState<'board' | 'list'>('board')
  const [search, setSearch] = useState('')
  const [showNewIssue, setShowNewIssue] = useState(false)
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
  const issuesParams = { project_id: activeProjectId === 'all' ? undefined : activeProjectId }
  const issuesQuery = useListIssuesTeamsTeamIdIssuesGet(team?.id ?? 0, issuesParams, {
    query: { enabled: Boolean(team) },
  })
  const updateIssue = useUpdateIssueIssuesIssueIdPatch()

  const filteredIssues = useMemo(() => {
    let issues = issuesQuery.data?.items ?? []

    if (priorityFilter !== 'all') {
      issues = issues.filter((issue) => issue.priority === priorityFilter)
    }
    if (assigneeFilter === 'unassigned') {
      issues = issues.filter((issue) => !issue.assignee)
    } else if (assigneeFilter !== 'all') {
      issues = issues.filter((issue) => issue.assignee?.id === assigneeFilter)
    }
    return issues
  }, [issuesQuery.data, priorityFilter, assigneeFilter])

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
    } catch {
      queryClient.setQueryData(queryKey, previous)
    }
  }

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

  const closeIssue = () => navigate(`/${team.key}`)

  return (
    <TeamProvider
      value={{
        team,
        teams,
        projects: projectsQuery.data ?? [],
        labels: labelsQuery.data ?? [],
        members: membersQuery.data ?? [],
      }}
    >
      <div className="flex h-screen bg-neutral-50">
        <Sidebar activeProjectId={activeProjectId} onSelectProject={setActiveProjectId} />
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
            ) : view === 'board' ? (
              <KanbanBoard issues={filteredIssues} onStatusChange={handleStatusChange} />
            ) : (
              <IssueListView issues={filteredIssues} />
            )}
          </div>
        </div>
      </div>

      {showNewIssue && <NewIssueModal onClose={() => setShowNewIssue(false)} />}
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
