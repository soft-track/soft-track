import type {
  SprintRead,
  LabelRead,
  ProjectRead,
  ReleaseRead,
  StatusRead,
  TeamMemberRead,
} from '@/api/generated/models'
import { addDays, format, parseISO } from 'date-fns'

import type { BoardFilters, FilterKey, FilterValue, ManyKey, WhenFilter } from '@/board/filters'
import { FILTER_KEYS, MANY_KEYS, withoutFilter, withoutValue } from '@/board/filters'
import { i18n } from '@/i18n'
import { formatDate } from '@/i18n/format'
import { DUE_FILTER_LABEL } from '@/tickets/dueDate'
import { PRIORITY_META, TYPE_META } from '@/tickets/ticketMeta'

export { withoutFilter }

/** What the filter bar needs in order to name an id. */
export type FilterLookups = {
  members: TeamMemberRead[]
  labels: LabelRead[]
  projects: ProjectRead[]
  sprints: SprintRead[]
  statuses: StatusRead[]
  /** The team's releases (#272); none for a team that has not made any. */
  releases?: ReleaseRead[]
}

/** One chosen value inside a chip, which can be removed on its own. */
export type ChipPart = {
  /** "Mei Tanaka", "Bug". */
  label: string
  /** The filters with this value taken out. */
  without: BoardFilters
}

export type FilterChip = {
  /** Which filter the chip is. */
  key: FilterKey
  /** "Assignee", "Label" -- what is being filtered on. */
  field: string
  /** "not", when the filter excludes its values. */
  prefix: string | null
  /** "or" between alternatives; "and" between labels that must all be there. */
  joiner: string
  /** Each chosen value, in order. */
  parts: ChipPart[]
  /** The whole thing in words: "not Mei Tanaka or Daniel Okafor". */
  value: string
}

export const EMPTY_LOOKUPS: FilterLookups = {
  members: [],
  labels: [],
  projects: [],
  sprints: [],
  statuses: [],
}

const FIELD = {
  status: 'status',
  priority: 'priority',
  assignee: 'assignee',
  label: 'label',
  type: 'type',
  projectId: 'project',
  sprintId: 'sprint',
  due: 'due',
  creator: 'creator',
  updated: 'updated',
  created: 'created',
  hasNo: 'hasNo',
  watching: 'watching',
  release: 'release',
} as const satisfies Record<FilterKey, string>

/**
 * Status, priority, assignee and label first, as they always were; then the
 * epic and sprint, then type and due; then what #261 added, in the order its
 * chips were drawn: updated, created, has no, created by, watching.
 */
const CHIP_ORDER: readonly FilterKey[] = [
  'status',
  'priority',
  'assignee',
  'label',
  'projectId',
  'sprintId',
  'type',
  'due',
  ...FILTER_KEYS.slice(FILTER_KEYS.indexOf('updated')),
]

/** A filter's field name: "Status", "Epic". */
export function fieldName(key: FilterKey): string {
  return i18n.t(`board:filters.fields.${FIELD[key]}`)
}

/**
 * One value of a filter, named.
 *
 * Ids are resolved against the team's own data, so a value pointing at
 * something that has since gone -- a label deleted, a colleague removed from
 * the team, an id someone typed into the URL -- still has a name and a chip
 * that can be cleared, rather than vanishing and leaving a board that is
 * filtered for no visible reason.
 */
export function valueName<K extends ManyKey>(
  key: K,
  value: FilterValue<K>,
  lookups: FilterLookups = EMPTY_LOOKUPS,
): string {
  switch (key) {
    case 'status':
      return (
        lookups.statuses.find((status) => status.id === value)?.name ??
        i18n.t('board:filters.missing.status')
      )
    case 'priority':
      return PRIORITY_META[value as FilterValue<'priority'>].label
    case 'assignee':
    case 'creator':
      if (value === 'me') return i18n.t('board:filters.me')
      if (value === 'unassigned') return i18n.t('board:filters.unassigned')
      return (
        lookups.members.find((member) => member.user.id === value)?.user.full_name ??
        i18n.t(key === 'creator' ? 'board:filters.missing.creator' : 'board:filters.missing.assignee')
      )
    case 'label':
      return (
        lookups.labels.find((label) => label.id === value)?.name ??
        i18n.t('board:filters.missing.label')
      )
    case 'release':
      return (
        (lookups.releases ?? []).find((release) => release.id === value)?.name ??
        i18n.t('board:filters.missing.release')
      )
    default:
      return TYPE_META[value as FilterValue<'type'>].label
  }
}

function chip(
  key: FilterKey,
  parts: ChipPart[],
  prefix: string | null = null,
  joiner: string = i18n.t('board:filters.or'),
): FilterChip {
  const words = parts.map((part) => part.label).join(` ${joiner} `)
  return {
    key,
    field: fieldName(key),
    prefix,
    joiner,
    parts,
    value: prefix ? `${prefix} ${words}` : words,
  }
}

/**
 * The active filters, as chips a person can read and take apart: one chip
 * per filter, "Mei or Daniel", and each value in it removable on its own.
 */
export function describeFilters(
  filters: BoardFilters,
  lookups: FilterLookups = EMPTY_LOOKUPS,
): FilterChip[] {
  const chips: FilterChip[] = []

  const many = <K extends ManyKey>(key: K) => {
    const filter = filters[key]
    if (filter.values.length === 0) return
    const parts = (filter.values as FilterValue<K>[]).map((value) => ({
      label: valueName(key, value, lookups),
      without: withoutValue(filters, key, value),
    }))
    const all = key === 'label' && filters.label.match === 'all' && parts.length > 1
    chips.push(
      chip(
        key,
        parts,
        filter.exclude ? i18n.t('board:filters.not') : null,
        all ? i18n.t('board:filters.and') : i18n.t('board:filters.or'),
      ),
    )
  }
  const one = (key: FilterKey, label: string) =>
    chips.push(chip(key, [{ label, without: withoutFilter(filters, key) }]))

  for (const key of CHIP_ORDER) {
    if ((MANY_KEYS as readonly string[]).includes(key)) {
      many(key as ManyKey)
    } else if (key === 'projectId' && filters.projectId !== null) {
      one(
        key,
        lookups.projects.find((p) => p.id === filters.projectId)?.name ??
          i18n.t('board:filters.missing.project'),
      )
    } else if (key === 'sprintId' && filters.sprintId !== null) {
      one(
        key,
        lookups.sprints.find((s) => s.id === filters.sprintId)?.display_name ??
          i18n.t('board:filters.missing.sprint'),
      )
    } else if (key === 'due' && filters.due !== null) {
      one(key, DUE_FILTER_LABEL[filters.due])
    } else if (key === 'updated' || key === 'created') {
      const label = whenLabel(filters[key])
      if (label) one(key, label)
    } else if (key === 'hasNo' && filters.hasNo.length > 0) {
      // Each one asked narrows further, so they are joined with "and".
      const parts = filters.hasNo.map((field) => ({
        label: i18n.t(`board:filters.hasNo.${field}`),
        without: { ...filters, hasNo: filters.hasNo.filter((other) => other !== field) },
      }))
      chips.push(chip(key, parts, null, i18n.t('board:filters.and')))
    } else if (key === 'watching' && filters.watching) {
      const label = i18n.t('board:filters.watching.chipValue')
      chips.push({
        ...chip(key, [{ label, without: withoutFilter(filters, key) }]),
        field: i18n.t('board:filters.watching.chipField'),
      })
    }
  }

  return chips
}

/** A day as a chip shows it: "3 Sep 2026". */
function chipDay(day: string): string {
  return formatDate(parseISO(day), i18n.t('board:filters.chipDatePattern'))
}

/** A `yyyy-MM-dd` day moved by `days`. */
export function shiftDay(day: string, days: number): string {
  return format(addDays(parseISO(day), days), 'yyyy-MM-dd')
}

/**
 * When, in a chip's words: "last 30 days", "before 3 Sep 2026" (#261). The
 * API's days are both included, so "before" names the day after the last one
 * and "after" the day before the first: the day that was picked.
 */
export function whenLabel(when: WhenFilter): string | null {
  const parts: string[] = []
  if (when.window) parts.push(i18n.t(`board:filters.whenChip.${when.window}`))
  if (when.from && when.to) {
    parts.push(
      i18n.t('board:filters.whenChip.between', { from: chipDay(when.from), to: chipDay(when.to) }),
    )
  } else if (when.to) {
    parts.push(i18n.t('board:filters.whenChip.before', { date: chipDay(shiftDay(when.to, 1)) }))
  } else if (when.from) {
    parts.push(i18n.t('board:filters.whenChip.after', { date: chipDay(shiftDay(when.from, -1)) }))
  }
  return parts.length > 0 ? parts.join(', ') : null
}

/** A one-line summary, for a saved view's row in the sidebar. */
export function summarise(filters: BoardFilters, lookups?: FilterLookups): string {
  const chips = describeFilters(filters, lookups)
  if (chips.length === 0) return i18n.t('board:filters.allTickets')
  return chips.map((chip) => chip.value).join(' · ')
}
