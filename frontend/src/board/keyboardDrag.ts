import type {
  Announcements,
  KeyboardCoordinateGetter,
  KeyboardSensorOptions,
  ScreenReaderInstructions,
  UniqueIdentifier,
} from '@dnd-kit/core'

/**
 * Keys for moving a card without a mouse (#80).
 *
 * Space picks a card up and puts it down. Enter also puts it down, but does
 * not pick one up: Enter on a focused card already opens the issue, and a
 * keyboard user relies on that far more often than on dragging.
 */
export const KEYBOARD_CODES: NonNullable<KeyboardSensorOptions['keyboardCodes']> = {
  start: ['Space'],
  cancel: ['Escape'],
  end: ['Space', 'Enter'],
}

/**
 * Left and right jump a picked-up card to the next column, rather than
 * nudging it 25 pixels at a time as dnd-kit's default does -- a column is the
 * only place a card can land, so every keypress should reach one.
 *
 * Up and down are ignored: there is no order within a column to move through.
 */
export const columnCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates, context },
) => {
  if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return undefined
  event.preventDefault()

  const width = context.collisionRect?.width ?? 0
  const columns = [...context.droppableRects.entries()]
    .map(([id, rect]) => ({ id, rect }))
    .sort((a, b) => a.rect.left - b.rect.left)
  if (columns.length === 0) return undefined

  // Where the card is now: the column it is over, else the one under its middle.
  const centre = currentCoordinates.x + width / 2
  let index = columns.findIndex((column) => column.id === context.over?.id)
  if (index === -1) {
    index = columns.findIndex(
      ({ rect }) => centre >= rect.left && centre <= rect.left + rect.width,
    )
  }

  const step = event.code === 'ArrowRight' ? 1 : -1
  const next = columns[Math.min(Math.max(index + step, 0), columns.length - 1)]
  return {
    x: next.rect.left + (next.rect.width - width) / 2,
    y: currentCoordinates.y,
  }
}

/** What a screen reader hears before anything is picked up. */
export const INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'To move this issue to another column, press Space to pick it up, the left and ' +
    'right arrow keys to choose a column, and Space again to drop it. Escape cancels. ' +
    'Enter opens the issue.',
}

/**
 * The words read out during a move, e.g. "Moved ENG-42 to In Progress".
 *
 * Built from lookups rather than from dnd-kit's ids, which are numbers and
 * `status:3` strings nobody should have to hear.
 */
export function announcements({
  issueName,
  columnName,
  startColumn,
  drag,
}: {
  issueName: (id: UniqueIdentifier) => string
  columnName: (id: UniqueIdentifier | undefined) => string | null
  /** The column the card started in, for "stays in" when a move is abandoned. */
  startColumn: (id: UniqueIdentifier) => string | null
  /**
   * Whether the card has left its starting column yet, kept by the caller
   * across renders. dnd-kit reports the card as over its own column in the
   * same tick as the pickup, and announcing that would overwrite the pickup
   * instructions in the live region before anybody heard them.
   */
  drag: { moved: boolean }
}): Announcements {
  return {
    onDragStart({ active }) {
      drag.moved = false
      const from = startColumn(active.id)
      return `Picked up ${issueName(active.id)}${from ? ` in ${from}` : ''}. Use the left and right arrow keys to choose a column, Space to drop, Escape to cancel.`
    },
    onDragOver({ active, over }) {
      const column = columnName(over?.id)
      if (!drag.moved && column === startColumn(active.id)) return undefined
      drag.moved = true
      return column
        ? `${issueName(active.id)} is over ${column}.`
        : `${issueName(active.id)} is not over a column.`
    },
    onDragEnd({ active, over }) {
      const to = columnName(over?.id)
      const from = startColumn(active.id)
      if (!to) return `${issueName(active.id)} was not dropped on a column, so it stays in ${from}.`
      if (to === from) return `${issueName(active.id)} stays in ${to}.`
      return `Moved ${issueName(active.id)} to ${to}.`
    },
    onDragCancel({ active }) {
      return `Move cancelled. ${issueName(active.id)} stays in ${startColumn(active.id)}.`
    },
  }
}
