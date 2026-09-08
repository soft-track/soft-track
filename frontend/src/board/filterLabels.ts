import type {
  CycleRead,
  LabelRead,
  ProjectRead,
  StatusRead,
  TeamMemberRead,
} from '@/api/generated/models'
import type { BoardFilters } from '@/board/filters'
import { NO_FILTERS } from '@/board/filters'
import { PRIORITY_META } from '@/issues/issueMeta'

/** What the filter bar needs in order to name an id. */
export type FilterLookups = {
  members: TeamMemberRead[]
  labels: LabelRead[]
  projects: ProjectRead[]
  cycles: CycleRead[]
  statuses: StatusRead[]
}

export type FilterChip = {
  /** Which filter to clear when the chip's × is clicked. */
  key: keyof BoardFilters
  /** "Assignee", "Label" -- what is being filtered on. */
  field: string
  /** "Sam Rivera", "Bug" -- what it is filtered to. */
  value: string
}

export const EMPTY_LOOKUPS: FilterLookups = {
  members: [],
  labels: [],
  projects: [],
  cycles: [],
  statuses: [],
}

/**
 * The active filters, as chips a person can read and dismiss.
 *
 * Ids are resolved against the team's own data, so a filter pointing at
 * something that has since gone -- a label deleted, a colleague removed from
 * the team, an id someone typed into the URL -- still renders as a chip that
 * can be cleared, rather than vanishing and leaving a board that is filtered
 * for no visible reason.
 */
export function describeFilters(
  filters: BoardFilters,
  lookups: FilterLookups = EMPTY_LOOKUPS,
): FilterChip[] {
  const chips: FilterChip[] = []

  if (filters.statusId !== null) {
    chips.push({
      key: 'statusId',
      field: 'Status',
      value:
        lookups.statuses.find((status) => status.id === filters.statusId)?.name ??
        'Deleted status',
    })
  }
  if (filters.priority) {
    chips.push({
      key: 'priority',
      field: 'Priority',
      value: PRIORITY_META[filters.priority].label,
    })
  }
  if (filters.assignee !== null) {
    const value =
      filters.assignee === 'unassigned'
        ? 'Unassigned'
        : (lookups.members.find((m) => m.user.id === filters.assignee)?.user.full_name ??
          'Someone else')
    chips.push({ key: 'assignee', field: 'Assignee', value })
  }
  if (filters.labelId !== null) {
    chips.push({
      key: 'labelId',
      field: 'Label',
      value: lookups.labels.find((l) => l.id === filters.labelId)?.name ?? 'Deleted label',
    })
  }
  if (filters.projectId !== null) {
    chips.push({
      key: 'projectId',
      field: 'Project',
      value:
        lookups.projects.find((p) => p.id === filters.projectId)?.name ?? 'Deleted project',
    })
  }
  if (filters.cycleId !== null) {
    const cycle = lookups.cycles.find((c) => c.id === filters.cycleId)
    chips.push({
      key: 'cycleId',
      field: 'Cycle',
      value: cycle?.display_name ?? 'Deleted cycle',
    })
  }

  return chips
}

/** A one-line summary, for a saved view's row in the sidebar. */
export function summarise(filters: BoardFilters, lookups?: FilterLookups): string {
  const chips = describeFilters(filters, lookups)
  if (chips.length === 0) return 'All issues'
  return chips.map((chip) => chip.value).join(' · ')
}

/** Clearing one chip. */
export function withoutFilter(filters: BoardFilters, key: keyof BoardFilters): BoardFilters {
  return { ...filters, [key]: NO_FILTERS[key] }
}
