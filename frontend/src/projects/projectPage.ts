import type { IssueRead, ProjectState, StatusRead } from '@/api/generated/models'

export interface StatusGroup {
  status: StatusRead
  issues: IssueRead[]
}

/**
 * A project's issues, one group per status, in the team's own column order.
 *
 * Empty columns are left out: a project page is a list of what is in the
 * project, and five headings over nothing read as five things missing. An
 * issue whose status is not among `statuses` -- the team's list is loading, or
 * a column was just added -- still gets a group, after the known ones, rather
 * than disappearing from the page.
 */
export function groupByStatus(statuses: StatusRead[], issues: IssueRead[]): StatusGroup[] {
  const byStatus = new Map<number, IssueRead[]>()
  for (const issue of issues) {
    const group = byStatus.get(issue.status.id)
    if (group) group.push(issue)
    else byStatus.set(issue.status.id, [issue])
  }

  const groups: StatusGroup[] = []
  for (const status of statuses) {
    const group = byStatus.get(status.id)
    if (group) groups.push({ status, issues: group })
    byStatus.delete(status.id)
  }
  for (const group of byStatus.values()) {
    groups.push({ status: group[0].status, issues: group })
  }
  return groups
}

export const STATE_LABELS: Record<ProjectState, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

/**
 * The target date as a calendar day.
 *
 * `target_date` is a bare `YYYY-MM-DD`. Formatting it in UTC keeps it the day
 * that was picked: `new Date('2026-10-01')` is midnight UTC, which a local
 * formatter west of Greenwich would show as 30 September.
 */
export function formatTargetDate(targetDate: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${targetDate}T00:00:00Z`))
}

/**
 * Past its target and still open. A project that finished or was called off
 * late is not overdue any more; it is over.
 *
 * `today` is the viewer's own calendar day, as `YYYY-MM-DD`: the target is a
 * day, and it is missed when the viewer's day is past it.
 */
export function isOverdue(
  targetDate: string | null | undefined,
  state: ProjectState,
  today: string,
): boolean {
  if (!targetDate) return false
  if (state === 'completed' || state === 'cancelled') return false
  return targetDate < today
}
