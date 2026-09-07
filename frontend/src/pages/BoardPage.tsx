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
import { useListTeamMembersTeamsTeamIdMembersGet } from '../api/generated/endpoints/teams/teams'
import type { IssuePriority, IssueRead, IssueStatus } from '../api/generated/models'
import { IssueDetailPanel } from '../components/IssueDetailPanel'
import { IssueListView } from '../components/IssueListView'
import { KanbanBoard } from '../components/KanbanBoard'
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
  const [view, setView] = useState<'board' | 'list'>('board')
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
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      issues = issues.filter(
        (issue) =>
          issue.title.toLowerCase().includes(q) || issue.identifier.toLowerCase().includes(q),
      )
    }
    return issues
  }, [issuesQuery.data, search, priorityFilter, assigneeFilter])

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
            {issuesQuery.isLoading ? (
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
      {issueNumber && openIssue && (
        <IssueDetailPanel issueId={openIssue.id} onClose={closeIssue} />
      )}
    </TeamProvider>
  )
}
