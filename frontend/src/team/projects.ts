import type { QueryClient } from '@tanstack/react-query'

import type {
  IssueRead,
  ProjectRead,
  ProjectState,
  StatusRead,
} from '@/api/generated/models'
import { i18n } from '@/i18n'

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
  projectState('planned', 'var(--color-neutral-400)'),
  projectState('in_progress', 'var(--color-status-progress)'),
  projectState('completed', 'var(--color-status-done)'),
  projectState('cancelled', 'var(--color-status-cancelled)'),
]

// The label is a getter over the catalog (#106), so callers keep reading
// `stateMeta(state).label` and get the current language's word.
function projectState(id: ProjectState, colour: string) {
  return {
    id,
    colour,
    get label() {
      return i18n.t(`team:projects.states.${id}`)
    },
  }
}

export function stateMeta(state: ProjectState) {
  return PROJECT_STATES.find((candidate) => candidate.id === state) ?? PROJECT_STATES[0]
}

/**
 * The colours a new project can be given (#210). The first is the one the API
 * defaults to. Each is named, so a swatch reads as "Teal" rather than a hex
 * code to someone who cannot see it.
 */
export const PROJECT_COLOURS = [
  projectColour('indigo', '#6366f1'),
  projectColour('pink', '#ec4899'),
  projectColour('teal', '#14b8a6'),
  projectColour('amber', '#f59e0b'),
  projectColour('violet', '#8b5cf6'),
  projectColour('red', '#ef4444'),
  projectColour('green', '#22c55e'),
]

function projectColour(
  id: 'indigo' | 'pink' | 'teal' | 'amber' | 'violet' | 'red' | 'green',
  value: string,
) {
  return {
    id,
    value,
    get label() {
      return i18n.t(`team:projects.colours.${id}`)
    },
  }
}

/**
 * The colour a new project starts with: the first no project on the team is
 * wearing, so two can be told apart on the board without anyone choosing.
 * Archived projects count, since the issues still in them show the colour.
 * Once every colour is taken they are handed round again in order.
 */
export function nextProjectColour(projects: ProjectRead[]): string {
  const taken = new Set(projects.map((project) => project.color.toLowerCase()))
  const free = PROJECT_COLOURS.find((colour) => !taken.has(colour.value))
  return (free ?? PROJECT_COLOURS[projects.length % PROJECT_COLOURS.length]).value
}

/**
 * "3 of 5 done", or null for a project with nothing in it yet.
 *
 * The counts come from the server, already excluding cancelled issues -- the
 * same rule sub-issues follow (#13) -- so this only ever formats them.
 */
export function progressLabel(project: ProjectRead): string | null {
  if (project.issue_count === 0) return null
  return i18n.t('team:projects.progress', {
    completed: project.completed_issue_count,
    total: project.issue_count,
  })
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
