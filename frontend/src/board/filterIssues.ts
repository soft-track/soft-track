import type { IssuePriority, IssueRead } from '@/api/generated/models'

export type AssigneeFilter = 'all' | 'unassigned' | number

export type IssueFilters = {
  priority: IssuePriority | 'all'
  assignee: AssigneeFilter
  cycleId: number | null
}

export const NO_FILTERS: IssueFilters = { priority: 'all', assignee: 'all', cycleId: null }

/**
 * Narrow a loaded page of issues to what the board should show.
 *
 * A pure function rather than a hook so it can be tested without rendering
 * anything. These filters apply to the page that is already loaded; search
 * is the server's job (see search/).
 */
export function filterIssues(issues: IssueRead[], filters: IssueFilters): IssueRead[] {
  let result = issues

  if (filters.priority !== 'all') {
    result = result.filter((issue) => issue.priority === filters.priority)
  }
  if (filters.cycleId !== null) {
    result = result.filter((issue) => issue.cycle_id === filters.cycleId)
  }
  if (filters.assignee === 'unassigned') {
    result = result.filter((issue) => !issue.assignee)
  } else if (filters.assignee !== 'all') {
    result = result.filter((issue) => issue.assignee?.id === filters.assignee)
  }
  return result
}
