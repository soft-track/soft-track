import type {
  DateWindow,
  DueFilter,
  LabelMatch,
  MissingField,
  TicketPriority,
  TicketSeverity,
  TicketType,
  ListTicketsTeamsTeamIdTicketsGetParams,
  ViewFilters,
} from '@/api/generated/models'
import { localToday } from '@/tickets/dueDate'

/**
 * Someone in particular, nobody at all, or "me" -- whoever is looking, so a
 * shared view saved as assigned to me shows each viewer their own (#261).
 */
export type AssigneeChoice = number | 'unassigned' | 'me'
/** Who created a ticket: someone in particular, or "me". */
export type CreatorChoice = number | 'me'

/**
 * When a ticket was updated or created (#261): a window back from today, or
 * a range of days with both ends included. Either end alone is open.
 */
export type WhenFilter = { window: DateWindow | null; from: string | null; to: string | null }

export const NO_WHEN: WhenFilter = { window: null, from: null, to: null }

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
  /** Who created the ticket (#261). */
  creator: ManyFilter<CreatorChoice>
  updated: WhenFilter
  created: WhenFilter
  /** No estimate, no epic, no sprint: each one ticked narrows further. */
  hasNo: MissingField[]
  /** Only the tickets the viewer watches. */
  watching: boolean
  /** The release a ticket ships in (#272): its fix version. */
  release: ManyFilter<number>
  /** A bug's details (#273). Each narrows to bugs, either way round. */
  severity: ManyFilter<TicketSeverity>
  environment: ManyFilter<string>
  /** The release a bug was found in. */
  foundIn: ManyFilter<number>
}

/** The filters that take several values, each with a switch to exclude them. */
export const MANY_KEYS = [
  'status',
  'priority',
  'assignee',
  'label',
  'type',
  'creator',
  'release',
  'severity',
  'environment',
  'foundIn',
] as const
export type ManyKey = (typeof MANY_KEYS)[number]
/** The filters that still take one value. */
export const ONE_KEYS = ['projectId', 'sprintId', 'due'] as const
export type OneKey = (typeof ONE_KEYS)[number]
/** When a ticket changed or was made (#261). */
export const WHEN_KEYS = ['updated', 'created'] as const
export type WhenKey = (typeof WHEN_KEYS)[number]
/** Every filter. */
export type FilterKey = ManyKey | OneKey | WhenKey | 'hasNo' | 'watching'

/**
 * Every filter, in the order the menu lists them and the chips show them:
 * the ones there always were, then those #261 added.
 */
export const FILTER_KEYS: readonly FilterKey[] = [
  'status',
  'priority',
  'assignee',
  'label',
  'type',
  'projectId',
  'sprintId',
  'due',
  'updated',
  'created',
  'hasNo',
  'creator',
  'watching',
  'release',
  'severity',
  'environment',
  'foundIn',
]

/** What "has no" can ask about, in the menu's order. */
export const MISSING_ORDER: readonly MissingField[] = ['estimate', 'epic', 'sprint', 'fix_version']
/** The windows, in the menu's order. */
export const WINDOW_ORDER: readonly DateWindow[] = ['last_7_days', 'last_30_days', 'over_30_days']

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
  creator: { values: [], exclude: false },
  updated: NO_WHEN,
  created: NO_WHEN,
  hasNo: [],
  watching: false,
  release: { values: [], exclude: false },
  severity: { values: [], exclude: false },
  environment: { values: [], exclude: false },
  foundIn: { values: [], exclude: false },
}

const PRIORITY_VALUES: readonly string[] = ['no_priority', 'urgent', 'high', 'medium', 'low']
const DUE_VALUES: readonly string[] = ['overdue', 'this_week', 'none']
const TYPE_VALUES: readonly string[] = ['bug', 'task', 'story']
const SEVERITY_VALUES: readonly string[] = ['critical', 'major', 'minor', 'trivial']

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A day as `YYYY-MM-DD`, or nothing: a mangled date is no filter. */
function readDay(raw: string | null): string | null {
  if (raw === null || !DAY.test(raw)) return null
  return Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) ? null : raw
}

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
      read: (raw) => (raw === 'unassigned' || raw === 'me' ? raw : readNumber(raw)),
    },
    label: { key: 'label', read: readNumber },
    type: { key: 'type', read: readOneOf<TicketType>(TYPE_VALUES) },
    creator: { key: 'creator', read: (raw) => (raw === 'me' ? 'me' : readNumber(raw)) },
    release: { key: 'release', read: readNumber },
    severity: { key: 'severity', read: readOneOf<TicketSeverity>(SEVERITY_VALUES) },
    // A name: any text the team might have called a place it runs.
    environment: { key: 'environment', read: (raw) => raw.trim() || null },
    foundIn: { key: 'found_in', read: readNumber },
  }

const WINDOW_VALUES: readonly string[] = WINDOW_ORDER
const MISSING_VALUES: readonly string[] = MISSING_ORDER

/** `?updated=over_30_days`, `?updated_from=2026-09-01&updated_to=2026-09-30`. */
function readWhen(params: URLSearchParams, key: WhenKey): WhenFilter {
  return {
    window: readOneOf<DateWindow>(WINDOW_VALUES)(params.get(key) ?? ''),
    from: readDay(params.get(`${key}_from`)),
    to: readDay(params.get(`${key}_to`)),
  }
}

function writeWhen(params: URLSearchParams, key: WhenKey, when: WhenFilter) {
  if (when.window) params.set(key, when.window)
  if (when.from) params.set(`${key}_from`, when.from)
  if (when.to) params.set(`${key}_to`, when.to)
}

/** `?label_match=all`; any is the default and is not written. */
const LABEL_MATCH_KEY = 'label_match'
/** `?has_no=estimate&has_no=sprint`. */
const HAS_NO_KEY = 'has_no'
/** `?watching=1`. */
const WATCHING_KEY = 'watching'

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
    creator: readMany(params, 'creator'),
    updated: readWhen(params, 'updated'),
    created: readWhen(params, 'created'),
    hasNo: MISSING_ORDER.filter((field) =>
      params.getAll(HAS_NO_KEY).filter((raw) => MISSING_VALUES.includes(raw)).includes(field),
    ),
    watching: params.get(WATCHING_KEY) === '1',
    release: readMany(params, 'release'),
    severity: readMany(params, 'severity'),
    environment: readMany(params, 'environment'),
    foundIn: readMany(params, 'foundIn'),
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
  for (const key of WHEN_KEYS) writeWhen(params, key, filters[key])
  for (const field of filters.hasNo) params.append(HAS_NO_KEY, field)
  if (filters.watching) params.set(WATCHING_KEY, '1')
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
  const creator = apiMany(filters.creator)
  const release = apiMany(filters.release)
  const severity = apiMany(filters.severity)
  const environment = apiMany(filters.environment)
  const foundIn = apiMany(filters.foundIn)
  const people = filters.assignee.values.filter((value): value is number => typeof value === 'number')
  const creators = filters.creator.values.filter((value): value is number => typeof value === 'number')
  // Today goes with anything measured from it, so it is the viewer's today.
  const fromToday = Boolean(filters.due || filters.updated.window || filters.created.window)
  return {
    status_id: status.values,
    status_exclude: status.exclude,
    priority: priority.values,
    priority_exclude: priority.exclude,
    assignee_id: people.length > 0 ? people : undefined,
    unassigned: filters.assignee.values.includes('unassigned') ? true : undefined,
    assignee_me: filters.assignee.values.includes('me') ? true : undefined,
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
    creator_id: creators.length > 0 ? creators : undefined,
    creator_me: filters.creator.values.includes('me') ? true : undefined,
    creator_exclude: creator.exclude,
    updated: filters.updated.window ?? undefined,
    updated_from: filters.updated.from ?? undefined,
    updated_to: filters.updated.to ?? undefined,
    created: filters.created.window ?? undefined,
    created_from: filters.created.from ?? undefined,
    created_to: filters.created.to ?? undefined,
    has_no: filters.hasNo.length > 0 ? filters.hasNo : undefined,
    watching: filters.watching ? true : undefined,
    fix_version_id: release.values,
    fix_version_exclude: release.exclude,
    severity: severity.values,
    severity_exclude: severity.exclude,
    environment: environment.values,
    environment_exclude: environment.exclude,
    found_in_id: foundIn.values,
    found_in_exclude: foundIn.exclude,
    today: fromToday ? today : undefined,
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
        ...(filters.assignee_me ? ['me' as const] : []),
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
    creator: {
      values: [...(filters.creator_me ? ['me' as const] : []), ...(filters.creator_id ?? [])],
      exclude: filters.creator_exclude ?? false,
    },
    updated: {
      window: filters.updated ?? null,
      from: filters.updated_from ?? null,
      to: filters.updated_to ?? null,
    },
    created: {
      window: filters.created ?? null,
      from: filters.created_from ?? null,
      to: filters.created_to ?? null,
    },
    hasNo: filters.has_no ?? [],
    watching: filters.watching ?? false,
    release: {
      values: filters.fix_version_id ?? [],
      exclude: filters.fix_version_exclude ?? false,
    },
    severity: { values: filters.severity ?? [], exclude: filters.severity_exclude ?? false },
    environment: {
      values: filters.environment ?? [],
      exclude: filters.environment_exclude ?? false,
    },
    foundIn: { values: filters.found_in_id ?? [], exclude: filters.found_in_exclude ?? false },
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
    assignee_id: filters.assignee.values.filter((value): value is number => typeof value === 'number'),
    unassigned: filters.assignee.values.includes('unassigned'),
    assignee_me: filters.assignee.values.includes('me'),
    assignee_exclude: live(filters.assignee),
    label_id: filters.label.values,
    label_match: filters.label.values.length > 1 ? filters.label.match : 'any',
    label_exclude: live(filters.label),
    type: filters.type.values,
    type_exclude: live(filters.type),
    project_id: filters.projectId,
    sprint_id: filters.sprintId,
    due: filters.due,
    creator_id: filters.creator.values.filter((value): value is number => typeof value === 'number'),
    creator_me: filters.creator.values.includes('me'),
    creator_exclude: live(filters.creator),
    updated: filters.updated.window,
    updated_from: filters.updated.from,
    updated_to: filters.updated.to,
    created: filters.created.window,
    created_from: filters.created.from,
    created_to: filters.created.to,
    has_no: filters.hasNo,
    watching: filters.watching,
    fix_version_id: filters.release.values,
    fix_version_exclude: live(filters.release),
    severity: filters.severity.values,
    severity_exclude: live(filters.severity),
    environment: filters.environment.values,
    environment_exclude: live(filters.environment),
    found_in_id: filters.foundIn.values,
    found_in_exclude: live(filters.foundIn),
  }
}

/** Whether a when filter asks anything. */
export function whenIsSet(when: WhenFilter): boolean {
  return when.window !== null || when.from !== null || when.to !== null
}

/** Whether one filter is narrowing anything. */
export function isSet(filters: BoardFilters, key: FilterKey): boolean {
  if ((MANY_KEYS as readonly string[]).includes(key)) {
    return filters[key as ManyKey].values.length > 0
  }
  if (key === 'updated' || key === 'created') return whenIsSet(filters[key])
  if (key === 'hasNo') return filters.hasNo.length > 0
  if (key === 'watching') return filters.watching
  return filters[key as OneKey] !== null
}

/** How many filters are set: a filter of several values counts once. */
export function activeCount(filters: BoardFilters): number {
  return FILTER_KEYS.filter((key) => isSet(filters, key)).length
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
export function withoutFilter(filters: BoardFilters, key: FilterKey): BoardFilters {
  return { ...filters, [key]: NO_FILTERS[key] }
}

function sameValues<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value))
}

function sameWhen(a: WhenFilter, b: WhenFilter): boolean {
  return a.window === b.window && a.from === b.from && a.to === b.to
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
    a.due === b.due &&
    sameMany(a.creator, b.creator) &&
    sameWhen(a.updated, b.updated) &&
    sameWhen(a.created, b.created) &&
    sameValues(a.hasNo, b.hasNo) &&
    a.watching === b.watching &&
    sameMany(a.release, b.release) &&
    sameMany(a.severity, b.severity) &&
    sameMany(a.environment, b.environment) &&
    sameMany(a.foundIn, b.foundIn)
  )
}
