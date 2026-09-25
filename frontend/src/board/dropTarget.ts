import type { UniqueIdentifier } from '@dnd-kit/core'

/** What a drop means, worked out from where the card was let go (#88). */
export type Drop =
  /** Back where it was, or somewhere that is not a place. */
  | { kind: 'none' }
  /** On a column's empty space: change column, keep its place in the order. */
  | { kind: 'column'; columnId: string }
  /** Among the cards: between `aboveId` and `belowId` (null at an end). */
  | {
      kind: 'place'
      columnId: string
      aboveId: number | null
      belowId: number | null
      changesColumn: boolean
    }

type Column = { id: string; issues: Array<{ id: number }> }

/**
 * Where a card lands, given what it was dropped on.
 *
 * Card ids are numbers and column ids are strings (`status:3`), which is how
 * the two are told apart. Dropped on a card in its own column, it takes that
 * card's place and everything between shifts along -- the list order a
 * sortable list shows while dragging. Dropped on a card in another column,
 * it goes above that card.
 */
export function resolveDrop(
  columns: Column[],
  activeId: number,
  overId: UniqueIdentifier,
): Drop {
  const home = columns.find((column) => column.issues.some((issue) => issue.id === activeId))
  if (!home) return { kind: 'none' }

  if (typeof overId !== 'number') {
    const column = columns.find((candidate) => candidate.id === overId)
    if (!column || column.id === home.id) return { kind: 'none' }
    return { kind: 'column', columnId: column.id }
  }

  const target = columns.find((column) => column.issues.some((issue) => issue.id === overId))
  if (!target || overId === activeId) return { kind: 'none' }

  const ids = target.issues.map((issue) => issue.id)
  const to = ids.indexOf(overId)
  let order: number[]
  if (target.id === home.id) {
    const from = ids.indexOf(activeId)
    order = ids.filter((id) => id !== activeId)
    order.splice(to, 0, activeId)
    if (from === to) return { kind: 'none' }
  } else {
    order = [...ids.slice(0, to), activeId, ...ids.slice(to)]
  }
  const at = order.indexOf(activeId)
  return {
    kind: 'place',
    columnId: target.id,
    aboveId: order[at - 1] ?? null,
    belowId: order[at + 1] ?? null,
    changesColumn: target.id !== home.id,
  }
}
