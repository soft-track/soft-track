import { IssuePriority, IssueStatus } from '@/api/generated/models'
import type { IssueUpdateEstimate } from '@/api/generated/models'

export const STATUS_ORDER: IssueStatus[] = [
  IssueStatus.backlog,
  IssueStatus.todo,
  IssueStatus.in_progress,
  IssueStatus.in_review,
  IssueStatus.done,
  IssueStatus.cancelled,
]

export const STATUS_META: Record<IssueStatus, { label: string; dot: string }> = {
  backlog: { label: 'Backlog', dot: 'bg-status-backlog' },
  todo: { label: 'Todo', dot: 'bg-status-todo' },
  in_progress: { label: 'In Progress', dot: 'bg-status-progress' },
  in_review: { label: 'In Review', dot: 'bg-status-review' },
  done: { label: 'Done', dot: 'bg-status-done' },
  cancelled: { label: 'Cancelled', dot: 'bg-status-cancelled' },
}

export const PRIORITY_ORDER: IssuePriority[] = [
  IssuePriority.urgent,
  IssuePriority.high,
  IssuePriority.medium,
  IssuePriority.low,
  IssuePriority.no_priority,
]

export const PRIORITY_META: Record<IssuePriority, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: 'text-priority-urgent' },
  high: { label: 'High', color: 'text-priority-high' },
  medium: { label: 'Medium', color: 'text-priority-medium' },
  low: { label: 'Low', color: 'text-priority-low' },
  no_priority: { label: 'No priority', color: 'text-priority-none' },
}

/**
 * The story-point scale, mirroring ESTIMATE_SCALE in
 * backend/lib_softtrack/models/issues.py.
 *
 * The schema declares those five values as an enum, so orval generates a
 * literal union for the field and TypeScript refuses an off-scale estimate at
 * compile time. `satisfies` below is what keeps this list honest against it:
 * if the backend scale changes and the client is regenerated, this line stops
 * compiling instead of silently offering a value the API will reject.
 */
export const ESTIMATE_SCALE = [1, 2, 3, 5, 8] as const satisfies readonly NonNullable<
  IssueUpdateEstimate
>[]
