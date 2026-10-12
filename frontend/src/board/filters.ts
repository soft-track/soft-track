import type {
  DueFilter,
  LabelMatch,
  TicketPriority,
  TicketType,
  ListTicketsTeamsTeamIdTicketsGetParams,
  ViewFilters,
} from '@/api/generated/models'
import { localToday } from '@/tickets/dueDate'

/** Someone in particular, or nobody at all: one of the assignee choices. */
export type AssigneeChoice = number | 'unassigned'

/**
 * A filter that takes several values (#260).
 *
 * The values are alternatives -- Mei or Daniel -- and `exclude` turns the
 * filter round: everyone except these. No values is no opinion, whichever way
 * the switch is set.
 */
export type ManyFilter<T> = { values: T[]; exclude: boolean }

/**
 * What the board is narrowed to.
 *
 * Empty everywhere means "all tickets" rather than a filter matching nothing,
 * which is what makes an empty saved view sensible. Different filters narrow
 * each other.
 *
 * `unassigned` is deliberately a value of `assignee` rather than a flag beside
 * it: "assigned to nobody" is an answer to the same question as "assigned to
 * Mei", so it is one more box to tick.
 */
export type BoardFilters = {
  status: ManyFilter<number>
  priority: ManyFilter<TicketPriority>
  assignee: ManyFilter<AssigneeChoice>
  /** The one filter with a second question: any of the labels, or all. */
  label: ManyFilter<number> & { match: LabelMatch }
  /** Bug, task or story (#89). */
  type: ManyFilter<TicketType>
  projectId: number | null
  sprintId: number | null
  /** Overdue, due this week, or no due date (#87). */
  due: DueFilter | null
}

/** The filters that take several values, in the order the menu and the chips show them. */
export const MANY_KEYS = ['status', 'priority', 'assignee', 'label', 'type'] as const
export type ManyKey = (typeof MANY_KEYS)[number]
/** The filters that still take one value. */
export const ONE_KEYS = ['projectId', 'sprintId', 'due'] as const
export type OneKey = (typeof ONE_KEYS)[number]

export type FilterValue<K extends ManyKey> = BoardFilters[K]['values'][number]

export const NO_FILTERS: BoardFilters = {
  status: { values: [], exclude: false },
  priority: { values: [], exclude: false },
  assignee: { values: [], exclude: false },
  label: { values: [], exclude: false, match: 'any' },
  type: { values: [], exclude: false },
  projectId: null,
  sprintId: null,
  due: null,
}

const PRIORITY_VALUES: readonly string[] = ['no_priority', 'urgent', 'high', 'medium', 'low']
const DUE_VALUES: readonly string[] = ['overdue', 'this_week', 'none']
const TYPE_VALUES: readonly string[] = ['bug', 'task', 'story']

function readNumber(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number(raw)
  // A hand-edited or truncated link should fall back to "no filter" rather
  // than sending NaN to the API and getting a 422.
  return Number.isInteger(value) && value > 0 ? value : null
}

function readOneOf<T extends string>(allowed: readonly string[]) {
  return (raw: string): T | null => (allowed.includes(raw) ? (raw as T) : null)
}

/**
 * How each multi-value filter is written in a link.
 *
 * The keys are short and stable: they end up in links people paste to each
 * other, so renaming one breaks every link already sent. Deliberately not the
 * API's names (`label_id`), which are an implementation detail of the
 * request. A value that does not parse is dropped, and the rest kept.
 */
const MANY_URL: { [K in ManyKey]: { key: string; read: (raw: string) => FilterValue<K> | null } } =
  {
    // A status is a row id, so a link naming a status another team deleted
    // shows a wider board rather than an error.
    status: { key: 'status', read: readNumber },
    priority: { key: 'priority', read: readOneOf<TicketPriority>(PRIORITY_VALUES) },
    assignee: {
      key: 'assignee',
      read: (raw) => (raw === 'unassigned' ? 'unassigned' : readNumber(raw)),
    },
    label: { key: 'label', read: readNumber },
    type: { key: 'type', read: readOneOf<TicketType>(TYPE_VALUES) },
  }

/** `?label_match=all`; any is the default and is not written. */
const LABEL_MATCH_KEY = 'label_match'

const ONE_URL = { projectId: 'project', sprintId: 'sprint', due: 'due' } as const

/**
 * Keys a filter used to be written under, still read -- never written -- so
 * the links already sent keep working. Sprints were called cycles until #214.
 */
const LEGACY_KEYS = {
  sprintId: 'cycle',
} as const

/**
 * The key a filter's values are written under when it excludes them:
 * `?status!=5` is every status except 5. Read back by `URLSearchParams` as
 * the key `status!`.
 */
const excluded = (key: string) => `${key}!`

function unique<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index)
}

function readMany<K extends ManyKey>(params: URLSearchParams, name: K): ManyFilter<FilterValue<K>> {
  const { key, read } = MANY_URL[name]
  const parse = (raws: string[]) =>
    unique(raws.map(read).filter((value): value is FilterValue<K> => value !== null))
  // A link that says both is read as the exclusion, which is the one a
  // person would have had to type on purpose.
  const without = parse(params.getAll(excluded(key)))
  if (without.length > 0) return { values: without, exclude: true }
  return { values: parse(params.getAll(key)), exclude: false }
}

/**
 * The filters a URL is asking for. Anything unparseable is simply not a filter.
 *
 * A filter repeats for several values (`?assignee=3&assignee=4`), so a link
 * from before filters took lists -- `?assignee=3` -- reads as a list of one
 * and opens what it always did (#260).
 */
export function fromSearchParams(params: URLSearchParams): BoardFilters {
  return {
    status: readMany(params, 'status'),
    priority: readMany(params, 'priority'),
    assignee: readMany(params, 'assignee'),
    label: {
      ...readMany(params, 'label'),
      match: params.get(LABEL_MATCH_KEY) === 'all' ? 'all' : 'any',
    },
    type: readMany(params, 'type'),
    projectId: readNumber(params.get(ONE_URL.projectId)),
    sprintId: readNumber(params.get(ONE_URL.sprintId) ?? params.get(LEGACY_KEYS.sprintId)),
    due: readOneOf<DueFilter>(DUE_VALUES)(params.get(ONE_URL.due) ?? ''),
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
  for (const name of MANY_KEYS) {
    const { values, exclude } = filters[name]
    const key = exclude ? excluded(MANY_URL[name].key) : MANY_URL[name].key
    for (const value of values) params.append(key, String(value))
    if (name === 'label' && values.length > 1 && filters.label.match === 'all') {
      params.set(LABEL_MATCH_KEY, 'all')
    }
  }
  if (filters.projectId !== null) params.set(ONE_URL.projectId, String(filters.projectId))
  if (filters.sprintId !== null) params.set(ONE_URL.sprintId, String(filters.sprintId))
  if (filters.due) params.set(ONE_URL.due, filters.due)
  return params
}

/**
 * A query string as the address bar should show it.
 *
 * `URLSearchParams` escapes the `!` of an excluded filter (`status%21=5`);
 * it means the same either way, and `status!=5` is the one a person can read.
 */
export function searchString(params: URLSearchParams): string {
  return params.toString().replace(/%21=/g, '!=')
}

/** The values and switch of one filter as the API wants them: nothing for no opinion. */
function apiMany<T>(filter: ManyFilter<T>): { values?: T[]; exclude?: true } {
  if (filter.values.length === 0) return {}
  return { values: filter.values, exclude: filter.exclude ? true : undefined }
}

/**
 * The same filters as the ticket list endpoint wants them.
 *
 * `today` goes with a due filter so "this week" is the viewer's week, not
 * the server's.
 */
export function toQueryParams(
  filters: BoardFilters,
  today = localToday(),
): ListTicketsTeamsTeamIdTicketsGetParams {
  const status = apiMany(filters.status)
  const priority = apiMany(filters.priority)
  const assignee = apiMany(filters.assignee)
  const label = apiMany(filters.label)
  const type = apiMany(filters.type)
  const people = filters.assignee.values.filter(
    (value): value is number => value !== 'unassigned',
  )
  return {
    status_id: status.values,
    status_exclude: status.exclude,
    priority: priority.values,
    priority_exclude: priority.exclude,
    assignee_id: people.length > 0 ? people : undefined,
    unassigned: filters.assignee.values.includes('unassigned') ? true : undefined,
    assignee_exclude: assignee.exclude,
    label_id: label.values,
    label_match:
      filters.label.values.length > 1 && filters.label.match === 'all' ? 'all' : undefined,
    label_exclude: label.exclude,
    type: type.values,
    type_exclude: type.exclude,
    project_id: filters.projectId ?? undefined,
    sprint_id: filters.sprintId ?? undefined,
    due: filters.due ?? undefined,
    today: filters.due ? today : undefined,
  }
}

/**
 * The same filters as a flat list of query-string pairs, for a request the
 * generated client does not make (the CSV export). Lists repeat their key.
 */
export function toQueryString(filters: BoardFilters, today = localToday()): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(toQueryParams(filters, today))) {
    if (value === undefined || value === null) continue
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item))
  }
  return params
}

/** A saved view's filters, as the board holds them. */
export function fromViewFilters(filters: ViewFilters): BoardFilters {
  return {
    status: { values: filters.status_id ?? [], exclude: filters.status_exclude ?? false },
    priority: { values: filters.priority ?? [], exclude: filters.priority_exclude ?? false },
    assignee: {
      values: [
        ...(filters.unassigned ? ['unassigned' as const] : []),
        ...(filters.assignee_id ?? []),
      ],
      exclude: filters.assignee_exclude ?? false,
    },
    label: {
      values: filters.label_id ?? [],
      exclude: filters.label_exclude ?? false,
      match: filters.label_match ?? 'any',
    },
    type: { values: filters.type ?? [], exclude: filters.type_exclude ?? false },
    projectId: filters.project_id ?? null,
    sprintId: filters.sprint_id ?? null,
    due: filters.due ?? null,
  }
}

/** The board's filters, as a saved view stores them. */
export function toViewFilters(filters: BoardFilters): ViewFilters {
  const live = <T>(filter: ManyFilter<T>) => filter.values.length > 0 && filter.exclude
  return {
    status_id: filters.status.values,
    status_exclude: live(filters.status),
    priority: filters.priority.values,
    priority_exclude: live(filters.priority),
    assignee_id: filters.assignee.values.filter(
      (value): value is number => value !== 'unassigned',
    ),
    unassigned: filters.assignee.values.includes('unassigned'),
    assignee_exclude: live(filters.assignee),
    label_id: filters.label.values,
    label_match: filters.label.values.length > 1 ? filters.label.match : 'any',
    label_exclude: live(filters.label),
    type: filters.type.values,
    type_exclude: live(filters.type),
    project_id: filters.projectId,
    sprint_id: filters.sprintId,
    due: filters.due,
  }
}

/** Whether one filter is narrowing anything. */
export function isSet(filters: BoardFilters, key: ManyKey | OneKey): boolean {
  if ((MANY_KEYS as readonly string[]).includes(key)) {
    return filters[key as ManyKey].values.length > 0
  }
  return filters[key as OneKey] !== null
}

/** How many filters are set: a filter of several values counts once. */
export function activeCount(filters: BoardFilters): number {
  return [...MANY_KEYS, ...ONE_KEYS].filter((key) => isSet(filters, key)).length
}

export function isEmpty(filters: BoardFilters): boolean {
  return activeCount(filters) === 0
}

/** One value ticked or unticked, keeping the values in `order` -- the menu's. */
export function toggleValue<K extends ManyKey>(
  filters: BoardFilters,
  key: K,
  value: FilterValue<K>,
  order: readonly FilterValue<K>[],
): BoardFilters {
  const current = filters[key].values as FilterValue<K>[]
  // Anything chosen that the menu no longer offers stays, at the end.
  const next = current.includes(value)
    ? current.filter((other) => other !== value)
    : [
        ...order.filter((other) => other === value || current.includes(other)),
        ...current.filter((other) => !order.includes(other)),
      ]
  return { ...filters, [key]: { ...filters[key], values: next } }
}

/** One value taken out of a filter: a chip's ×. */
export function withoutValue<K extends ManyKey>(
  filters: BoardFilters,
  key: K,
  value: FilterValue<K>,
): BoardFilters {
  const values = (filters[key].values as FilterValue<K>[]).filter((other) => other !== value)
  return { ...filters, [key]: { ...filters[key], values } }
}

/** A filter cleared, switches and all. */
export function withoutFilter(filters: BoardFilters, key: ManyKey | OneKey): BoardFilters {
  return { ...filters, [key]: NO_FILTERS[key] }
}

function sameValues<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value))
}

function sameMany<T>(a: ManyFilter<T>, b: ManyFilter<T>): boolean {
  if (a.values.length === 0 && b.values.length === 0) return true
  return sameValues(a.values, b.values) && a.exclude === b.exclude
}

/**
 * Whether two filter sets ask the same question.
 *
 * The sidebar uses this to mark which saved view is showing. Comparing the
 * filters rather than tracking a view id is what lets a link carry the
 * filters themselves -- so a shared URL works for someone who cannot see the
 * private view it happened to come from, and still lights up the right row
 * for someone who can. Order within a filter does not matter, and neither
 * does a switch on a filter with nothing chosen.
 */
export function sameFilters(a: BoardFilters, b: BoardFilters): boolean {
  const labelMatch = (filters: BoardFilters) =>
    filters.label.values.length > 1 ? filters.label.match : 'any'
  return (
    sameMany(a.status, b.status) &&
    sameMany(a.priority, b.priority) &&
    sameMany(a.assignee, b.assignee) &&
    sameMany(a.label, b.label) &&
    labelMatch(a) === labelMatch(b) &&
    sameMany(a.type, b.type) &&
    a.projectId === b.projectId &&
    a.sprintId === b.sprintId &&
    a.due === b.due
  )
}
