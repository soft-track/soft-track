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
 * Up and down step it past the next card in its column (#88), which is how
 * the order within a column is changed without a mouse.
 */
export const columnCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates, context },
) => {
  if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
    return cardStep(event, currentCoordinates, context)
  }
  if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return undefined
  event.preventDefault()

  const width = context.collisionRect?.width ?? 0
  // Columns only: cards are droppables too, but a card's id is a number.
  const columns = [...context.droppableRects.entries()]
    .filter(([id]) => typeof id !== 'number')
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

type GetterArgs = Parameters<KeyboardCoordinateGetter>[1]

/** Up or down one card within the column the carried card is in. */
function cardStep(
  event: KeyboardEvent,
  current: GetterArgs['currentCoordinates'],
  context: GetterArgs['context'],
) {
  const width = context.collisionRect?.width ?? 0
  const centre = current.x + width / 2
  const cards = [...context.droppableRects.entries()]
    .filter(([id]) => typeof id === 'number')
    .map(([, rect]) => rect)
    .filter((rect) => centre >= rect.left && centre <= rect.left + rect.width)
    .sort((a, b) => a.top - b.top)
  if (cards.length === 0) return undefined
  event.preventDefault()
  // The card it is level with now -- at first, its own place.
  let here = 0
  cards.forEach((rect, i) => {
    if (Math.abs(rect.top - current.y) < Math.abs(cards[here].top - current.y)) here = i
  })
  const step = event.code === 'ArrowDown' ? 1 : -1
  const next = cards[Math.min(Math.max(here + step, 0), cards.length - 1)]
  return { x: current.x, y: next.top }
}

/** What a screen reader hears before anything is picked up. */
export const INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    'To move this issue, press Space to pick it up. The left and right arrow keys ' +
    'choose a column, up and down move it past the cards above and below, and Space ' +
    'drops it. Escape cancels. Enter opens the issue.',
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
  /**
   * The column a droppable stands for: a column's own id, or a card's, which
   * stands for the column the card is in.
   */
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
      return `Picked up ${issueName(active.id)}${from ? ` in ${from}` : ''}. Use the arrow keys to move it, Space to drop, Escape to cancel.`
    },
    onDragOver({ active, over }) {
      const column = columnName(over?.id)
      // Over itself -- which is where it starts -- says nothing new.
      if (over?.id === active.id) return undefined
      if (!drag.moved && column === startColumn(active.id) && typeof over?.id !== 'number') {
        return undefined
      }
      drag.moved = true
      if (!column) return `${issueName(active.id)} is not over a column.`
      // Over a card: say which, since that is where it will land (#88).
      if (typeof over?.id === 'number') {
        return `${issueName(active.id)} is in ${column}, next to ${issueName(over.id)}.`
      }
      return `${issueName(active.id)} is over ${column}.`
    },
    onDragEnd({ active, over }) {
      const to = columnName(over?.id)
      const from = startColumn(active.id)
      if (!to) return `${issueName(active.id)} was not dropped on a column, so it stays in ${from}.`
      if (to === from) {
        return over?.id === active.id || typeof over?.id !== 'number'
          ? `${issueName(active.id)} stays in ${to}.`
          : `Moved ${issueName(active.id)} within ${to}.`
      }
      return `Moved ${issueName(active.id)} to ${to}.`
    },
    onDragCancel({ active }) {
      return `Move cancelled. ${issueName(active.id)} stays in ${startColumn(active.id)}.`
    },
  }
}
