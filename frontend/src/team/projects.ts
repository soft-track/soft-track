import type { QueryClient } from '@tanstack/react-query'

import type {
  IssueRead,
  ProjectRead,
  ProjectState,
  StatusRead,
} from '@/api/generated/models'

/**
 * The projects a picker should offer.
 *
 * Archived projects stay in the team's list -- issues still point at them and
 * need a name to show -- but nobody should be filing new work into one.
 * `keepId` is the same exception `activeMembers` makes: a filter or a rule
 * already set to an archived project has to keep showing it, or the dropdown
 * would render blank and the next save would quietly clear it.
 */
export function pickableProjects(
  projects: ProjectRead[],
  keepId?: number | null,
): ProjectRead[] {
  return projects.filter((project) => !project.archived || project.id === keepId)
}

/** How each state reads, in the order a project moves through them. */
export const PROJECT_STATES: Array<{ id: ProjectState; label: string; colour: string }> = [
  { id: 'planned', label: 'Planned', colour: 'var(--color-neutral-400)' },
  { id: 'in_progress', label: 'In progress', colour: 'var(--color-status-progress)' },
  { id: 'completed', label: 'Completed', colour: 'var(--color-status-done)' },
  { id: 'cancelled', label: 'Cancelled', colour: 'var(--color-status-cancelled)' },
]

export function stateMeta(state: ProjectState) {
  return PROJECT_STATES.find((candidate) => candidate.id === state) ?? PROJECT_STATES[0]
}

/**
 * "3 of 5 done", or null for a project with nothing in it yet.
 *
 * The counts come from the server, already excluding cancelled issues -- the
 * same rule sub-issues follow (#13) -- so this only ever formats them.
 */
export function progressLabel(project: ProjectRead): string | null {
  if (project.issue_count === 0) return null
  return `${project.completed_issue_count} of ${project.issue_count} done`
}

export function progressRatio(project: ProjectRead): number {
  return project.issue_count === 0 ? 0 : project.completed_issue_count / project.issue_count
}

/**
 * The team's statuses that hold any of these issues, each with its issues, in
 * board order. Empty columns are left out: on a project page they are noise,
 * where on the board they are somewhere to drag to.
 */
export function groupByStatus(
  issues: IssueRead[],
  statuses: StatusRead[],
): Array<{ status: StatusRead; issues: IssueRead[] }> {
  return statuses
    .map((status) => ({
      status,
      issues: issues.filter((issue) => issue.status.id === status.id),
    }))
    .filter((group) => group.issues.length > 0)
}

/**
 * Refetch everything that shows project progress.
 *
 * Progress moves with any write to an issue -- its status, its project, or
 * the issue going away -- so every such write calls this, the same way they
 * already refresh the cycle and estimate rollups.
 */
export function invalidateProjects(queryClient: QueryClient, teamId: number) {
  queryClient.invalidateQueries({ queryKey: [`/teams/${teamId}/projects`] })
  queryClient.invalidateQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/projects/'),
  })
}
