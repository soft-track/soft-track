import type {
  Announcements,
  KeyboardCoordinateGetter,
  KeyboardSensorOptions,
  ScreenReaderInstructions,
  UniqueIdentifier,
} from '@dnd-kit/core'

import { i18n } from '@/i18n'

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

/**
 * What a screen reader hears before anything is picked up. A function, so it
 * is read in the current language rather than the one at import.
 */
export const instructions = (): ScreenReaderInstructions => ({
  draggable: i18n.t('board:kanban.keyboard.instructions'),
})

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
      const issue = issueName(active.id)
      return from
        ? i18n.t('board:kanban.keyboard.pickedUpIn', { issue, column: from })
        : i18n.t('board:kanban.keyboard.pickedUp', { issue })
    },
    onDragOver({ active, over }) {
      const column = columnName(over?.id)
      // Over itself -- which is where it starts -- says nothing new.
      if (over?.id === active.id) return undefined
      if (!drag.moved && column === startColumn(active.id) && typeof over?.id !== 'number') {
        return undefined
      }
      drag.moved = true
      const issue = issueName(active.id)
      if (!column) return i18n.t('board:kanban.keyboard.notOverColumn', { issue })
      // Over a card: say which, since that is where it will land (#88).
      if (typeof over?.id === 'number') {
        return i18n.t('board:kanban.keyboard.nextTo', {
          issue,
          column,
          other: issueName(over.id),
        })
      }
      return i18n.t('board:kanban.keyboard.over', { issue, column })
    },
    onDragEnd({ active, over }) {
      const to = columnName(over?.id)
      const from = startColumn(active.id)
      const issue = issueName(active.id)
      if (!to) {
        return i18n.t('board:kanban.keyboard.notDropped', { issue, column: from ?? itsColumn() })
      }
      if (to === from) {
        return over?.id === active.id || typeof over?.id !== 'number'
          ? i18n.t('board:kanban.keyboard.stays', { issue, column: to })
          : i18n.t('board:kanban.keyboard.movedWithin', { issue, column: to })
      }
      return i18n.t('board:kanban.keyboard.movedTo', { issue, column: to })
    },
    onDragCancel({ active }) {
      return i18n.t('board:kanban.keyboard.cancelled', {
        issue: issueName(active.id),
        column: startColumn(active.id) ?? itsColumn(),
      })
    },
  }
}

/** A card in no column used to be announced as staying in "null". */
function itsColumn(): string {
  return i18n.t('board:kanban.keyboard.itsColumn')
}
