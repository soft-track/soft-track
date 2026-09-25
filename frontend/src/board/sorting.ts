import type { IssueSort, SortDirection } from '@/api/generated/models'
import type { BoardGrouping } from '@/board/grouping'
import { i18n } from '@/i18n'

/**
 * How the list is ordered (#88). Kept apart from the filters, like the
 * grouping: it narrows nothing, and a link without it means what it always
 * meant -- newest first.
 */
export type BoardSort = { sort: IssueSort; direction: SortDirection }

export const DEFAULT_SORT: BoardSort = { sort: 'created', direction: 'desc' }

// Labels are getters over the catalog (#106), so they are read when shown.
export const SORT_OPTIONS: Array<{ sort: IssueSort; label: string }> = [
  {
    sort: 'created',
    get label() {
      return i18n.t('board:arrange.sort.created')
    },
  },
  {
    sort: 'updated',
    get label() {
      return i18n.t('board:arrange.sort.updated')
    },
  },
  {
    sort: 'priority',
    get label() {
      return i18n.t('board:arrange.sort.priority')
    },
  },
  {
    sort: 'estimate',
    get label() {
      return i18n.t('board:arrange.sort.estimate')
    },
  },
  {
    sort: 'title',
    get label() {
      return i18n.t('board:arrange.sort.title')
    },
  },
]

const SORTS: readonly string[] = SORT_OPTIONS.map((option) => option.sort)

export function sortFromSearchParams(params: URLSearchParams): BoardSort {
  const sort = params.get('sort') ?? ''
  const direction = params.get('dir')
  if (!SORTS.includes(sort)) return DEFAULT_SORT
  return {
    sort: sort as IssueSort,
    direction: direction === 'asc' ? 'asc' : 'desc',
  }
}

/** `params` with the sort set, or removed when it is the default. */
export function withSort(params: URLSearchParams, value: BoardSort): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete('sort')
  next.delete('dir')
  if (!isDefaultSort(value)) {
    next.set('sort', value.sort)
    next.set('dir', value.direction)
  }
  return next
}

export function isDefaultSort(value: BoardSort): boolean {
  return value.sort === DEFAULT_SORT.sort && value.direction === DEFAULT_SORT.direction
}

export function sameSort(a: BoardSort, b: BoardSort): boolean {
  return a.sort === b.sort && a.direction === b.direction
}

/** A saved view's sort, where null means the default. */
export function fromViewSort(
  sort: IssueSort | null | undefined,
  direction: SortDirection | null | undefined,
): BoardSort {
  return sort ? { sort, direction: direction ?? 'desc' } : DEFAULT_SORT
}

/** The board's sort as a view stores it: null for the default. */
export function toViewSort(value: BoardSort): {
  sort: IssueSort | null
  sort_direction: SortDirection | null
} {
  return isDefaultSort(value)
    ? { sort: null, sort_direction: null }
    : { sort: value.sort, sort_direction: value.direction }
}

/** Everything about how the board is laid out that a saved view carries. */
export type Arrangement = { grouping: BoardGrouping; sort: BoardSort }
