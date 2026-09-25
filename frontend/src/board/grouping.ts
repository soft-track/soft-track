import type { IssueGrouping, IssueRead, ProjectRead } from '@/api/generated/models'

/**
 * How the board is arranged: by status, as it always was, or by project (#63).
 *
 * Kept apart from `BoardFilters` on purpose. A filter narrows the issue list
 * and is sent to the API; a grouping only arranges what came back. Folding it
 * into the filters would put it in the issue query and count it as an active
 * filter, neither of which is true.
 */
export type BoardGrouping = IssueGrouping

/**
 * The query-string key, beside the filter keys in `filters.ts`.
 *
 * Status is the default and is left out of the URL entirely, so every link
 * sent before grouping existed still means exactly what it meant -- and
 * `project`, the filter's key, keeps its meaning too.
 */
const KEY = 'group'

export function groupingFromSearchParams(params: URLSearchParams): BoardGrouping {
  return params.get(KEY) === 'project' ? 'project' : 'status'
}

/** `params` with the grouping set, or removed when it is the default. */
export function withGrouping(params: URLSearchParams, grouping: BoardGrouping): URLSearchParams {
  const next = new URLSearchParams(params)
  if (grouping === 'status') next.delete(KEY)
  else next.set(KEY, grouping)
  return next
}

/** One project's issues, or the issues in no project (`project: null`). */
export type ProjectGroup = {
  /** `project:5`, or `project:none`. Also the board column's drop target id. */
  key: string
  project: ProjectRead | null
  issues: IssueRead[]
}

export const NO_PROJECT_KEY = 'project:none'

/**
 * Issues arranged by project, in a stable order: projects by name, then the
 * issues in none.
 *
 * `includeEmpty` is for the board, where an empty column is somewhere to drop
 * a card. Even then an archived project only appears if it still holds one of
 * these issues -- it was retired from pickers, and a column is a picker. The
 * list has no use for empty sections and leaves them all out.
 */
export function groupByProject(
  issues: IssueRead[],
  projects: ProjectRead[],
  { includeEmpty }: { includeEmpty: boolean },
): ProjectGroup[] {
  const known = new Set(projects.map((project) => project.id))
  const groups: ProjectGroup[] = [...projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((project) => ({
      key: `project:${project.id}`,
      project,
      issues: issues.filter((issue) => issue.project_id === project.id),
    }))
    .filter((group) =>
      group.issues.length > 0 ? true : includeEmpty && !group.project!.archived,
    )

  // An issue whose project the team list does not know -- deleted a moment
  // ago, say -- is shown as in no project rather than dropped off the board.
  const loose = issues.filter(
    (issue) => issue.project_id == null || !known.has(issue.project_id),
  )
  if (loose.length > 0 || includeEmpty) {
    groups.push({ key: NO_PROJECT_KEY, project: null, issues: loose })
  }
  return groups
}

/** The project a board column's drop target id stands for, or undefined if it is not one. */
export function projectForDropTarget(id: string): number | null | undefined {
  if (id === NO_PROJECT_KEY) return null
  const match = /^project:(\d+)$/.exec(id)
  return match ? Number(match[1]) : undefined
}
