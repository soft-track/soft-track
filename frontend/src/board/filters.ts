import type {
  DueFilter,
  IssuePriority,
  IssueType,
  ListIssuesTeamsTeamIdIssuesGetParams,
  ViewFilters,
} from '@/api/generated/models'
import { localToday } from '@/issues/dueDate'

/** Someone in particular, nobody at all, or no opinion. */
export type AssigneeFilter = number | 'unassigned' | null

/**
 * What the board is narrowed to.
 *
 * Null everywhere means "all issues" rather than a filter matching nothing,
 * which is what makes an empty saved view sensible.
 *
 * `unassigned` is deliberately a value of `assignee` rather than a flag beside
 * it: "assigned to nobody" and "assigned to anybody" are answers to the same
 * question, and modelling them as two fields lets a caller ask for both.
 */
export type BoardFilters = {
  statusId: number | null
  priority: IssuePriority | null
  assignee: AssigneeFilter
  labelId: number | null
  projectId: number | null
  cycleId: number | null
  /** Overdue, due this week, or no due date (#87). */
  due: DueFilter | null
  /** Bug, task or story (#89). */
  type: IssueType | null
}

export const NO_FILTERS: BoardFilters = {
  statusId: null,
  priority: null,
  assignee: null,
  labelId: null,
  projectId: null,
  cycleId: null,
  due: null,
  type: null,
}

/**
 * The query-string key for each filter.
 *
 * Short and stable: these end up in links people paste to each other, so
 * renaming one breaks every link already sent. Deliberately not the API's
 * names (`label_id`), which are an implementation detail of the request.
 */
const KEYS = {
  statusId: 'status',
  priority: 'priority',
  assignee: 'assignee',
  labelId: 'label',
  projectId: 'project',
  cycleId: 'cycle',
  due: 'due',
  type: 'type',
} as const

const DUE_VALUES: readonly string[] = ['overdue', 'this_week', 'none']
const TYPE_VALUES: readonly string[] = ['bug', 'task', 'story']

function readNumber(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number(raw)
  // A hand-edited or truncated link should fall back to "no filter" rather
  // than sending NaN to the API and getting a 422.
  return Number.isInteger(value) && value > 0 ? value : null
}

/** The filters a URL is asking for. Anything unparseable is simply not a filter. */
export function fromSearchParams(params: URLSearchParams): BoardFilters {
  const assignee = params.get(KEYS.assignee)

  return {
    // A status is a row id now, so the same "unparseable means no filter"
    // rule covers it -- a link naming a status another team deleted shows an
    // unfiltered board rather than an error.
    statusId: readNumber(params.get(KEYS.statusId)),
    priority: (params.get(KEYS.priority) as IssuePriority | null) ?? null,
    assignee: assignee === 'unassigned' ? 'unassigned' : readNumber(assignee),
    labelId: readNumber(params.get(KEYS.labelId)),
    projectId: readNumber(params.get(KEYS.projectId)),
    cycleId: readNumber(params.get(KEYS.cycleId)),
    due: DUE_VALUES.includes(params.get(KEYS.due) ?? '')
      ? (params.get(KEYS.due) as DueFilter)
      : null,
    type: TYPE_VALUES.includes(params.get(KEYS.type) ?? '')
      ? (params.get(KEYS.type) as IssueType)
      : null,
  }
}

/**
 * The query string for a set of filters.
 *
 * Only what is set, so an unfiltered board has a clean URL and two ways of
 * expressing the same filters produce the same link.
 */
export function toSearchParams(filters: BoardFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.statusId !== null) params.set(KEYS.statusId, String(filters.statusId))
  if (filters.priority) params.set(KEYS.priority, filters.priority)
  if (filters.assignee !== null) params.set(KEYS.assignee, String(filters.assignee))
  if (filters.labelId !== null) params.set(KEYS.labelId, String(filters.labelId))
  if (filters.projectId !== null) params.set(KEYS.projectId, String(filters.projectId))
  if (filters.cycleId !== null) params.set(KEYS.cycleId, String(filters.cycleId))
  if (filters.due) params.set(KEYS.due, filters.due)
  if (filters.type) params.set(KEYS.type, filters.type)
  return params
}

/**
 * The same filters as the issue list endpoint wants them.
 *
 * `today` goes with a due filter so "this week" is the viewer's week, not
 * the server's.
 */
export function toQueryParams(
  filters: BoardFilters,
  today = localToday(),
): ListIssuesTeamsTeamIdIssuesGetParams {
  return {
    status_id: filters.statusId ?? undefined,
    priority: filters.priority ?? undefined,
    assignee_id: typeof filters.assignee === 'number' ? filters.assignee : undefined,
    unassigned: filters.assignee === 'unassigned' ? true : undefined,
    label_id: filters.labelId ?? undefined,
    project_id: filters.projectId ?? undefined,
    cycle_id: filters.cycleId ?? undefined,
    due: filters.due ?? undefined,
    today: filters.due ? today : undefined,
    type: filters.type ?? undefined,
  }
}

/** A saved view's filters, as the board holds them. */
export function fromViewFilters(filters: ViewFilters): BoardFilters {
  return {
    statusId: filters.status_id ?? null,
    priority: filters.priority ?? null,
    assignee: filters.unassigned ? 'unassigned' : (filters.assignee_id ?? null),
    labelId: filters.label_id ?? null,
    projectId: filters.project_id ?? null,
    cycleId: filters.cycle_id ?? null,
    due: filters.due ?? null,
    type: filters.type ?? null,
  }
}

/** The board's filters, as a saved view stores them. */
export function toViewFilters(filters: BoardFilters): ViewFilters {
  return {
    status_id: filters.statusId,
    priority: filters.priority,
    assignee_id: typeof filters.assignee === 'number' ? filters.assignee : null,
    unassigned: filters.assignee === 'unassigned',
    label_id: filters.labelId,
    project_id: filters.projectId,
    cycle_id: filters.cycleId,
    due: filters.due,
    type: filters.type,
  }
}

export function activeCount(filters: BoardFilters): number {
  return Object.values(filters).filter((value) => value !== null).length
}

export function isEmpty(filters: BoardFilters): boolean {
  return activeCount(filters) === 0
}

/**
 * Whether two filter sets ask the same question.
 *
 * The sidebar uses this to mark which saved view is showing. Comparing the
 * filters rather than tracking a view id is what lets a link carry the
 * filters themselves -- so a shared URL works for someone who cannot see the
 * private view it happened to come from, and still lights up the right row
 * for someone who can.
 */
export function sameFilters(a: BoardFilters, b: BoardFilters): boolean {
  return (
    a.statusId === b.statusId &&
    a.priority === b.priority &&
    a.assignee === b.assignee &&
    a.labelId === b.labelId &&
    a.projectId === b.projectId &&
    a.cycleId === b.cycleId &&
    a.due === b.due &&
    a.type === b.type
  )
}
