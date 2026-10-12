import type {
  SprintRead,
  LabelRead,
  ProjectRead,
  StatusRead,
  TeamMemberRead,
} from '@/api/generated/models'
import type { BoardFilters, FilterValue, ManyKey, OneKey } from '@/board/filters'
import { MANY_KEYS, withoutFilter, withoutValue } from '@/board/filters'
import { i18n } from '@/i18n'
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
  key: ManyKey | OneKey
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
} as const satisfies Record<ManyKey | OneKey, string>

/** A filter's field name: "Status", "Epic". */
export function fieldName(key: ManyKey | OneKey): string {
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
      return value === 'unassigned'
        ? i18n.t('board:filters.unassigned')
        : (lookups.members.find((member) => member.user.id === value)?.user.full_name ??
            i18n.t('board:filters.missing.assignee'))
    case 'label':
      return (
        lookups.labels.find((label) => label.id === value)?.name ??
        i18n.t('board:filters.missing.label')
      )
    default:
      return TYPE_META[value as FilterValue<'type'>].label
  }
}

function chip(
  key: ManyKey | OneKey,
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
  const one = (key: OneKey, label: string) =>
    chips.push(chip(key, [{ label, without: withoutFilter(filters, key) }]))

  // Status, priority, assignee and label first, as they always were; then
  // the epic and sprint, then type and due.
  for (const key of MANY_KEYS.filter((key) => key !== 'type')) many(key)
  if (filters.projectId !== null) {
    one(
      'projectId',
      lookups.projects.find((p) => p.id === filters.projectId)?.name ??
        i18n.t('board:filters.missing.project'),
    )
  }
  if (filters.sprintId !== null) {
    one(
      'sprintId',
      lookups.sprints.find((s) => s.id === filters.sprintId)?.display_name ??
        i18n.t('board:filters.missing.sprint'),
    )
  }
  many('type')
  if (filters.due !== null) one('due', DUE_FILTER_LABEL[filters.due])

  return chips
}

/** A one-line summary, for a saved view's row in the sidebar. */
export function summarise(filters: BoardFilters, lookups?: FilterLookups): string {
  const chips = describeFilters(filters, lookups)
  if (chips.length === 0) return i18n.t('board:filters.allTickets')
  return chips.map((chip) => chip.value).join(' · ')
}
