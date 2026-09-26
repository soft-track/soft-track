import { useDndMonitor } from '@dnd-kit/core'
import { useEffect } from 'react'

/**
 * A drop is not a click.
 *
 * A card is a link to its issue (#112), and a carried card follows the
 * pointer -- there is no overlay -- so when the pointer comes back up over
 * the card it carried, the browser ends the drag with a click on that link.
 * dnd-kit stops the click reaching the card's own handler, which would open
 * the panel, but a link does what a click on a link does all the same, and
 * follows it: without this, reordering a column would take you to the page
 * of the card you moved.
 *
 * So from the moment a card is picked up until just after it is put down, a
 * click on a card does nothing at all. "Just after" is the 50ms dnd-kit keeps
 * its own guard up for: the click comes in the same turn as the pointer
 * coming up, well inside it.
 *
 * Rendered inside the board's DndContext; it draws nothing.
 */
export function DropIsNotAClick() {
  useDndMonitor(MONITOR)
  useEffect(() => stop, [])
  return null
}

// On the window, while capturing: dnd-kit stops the click at the document, so
// nothing further down ever hears it.
const swallow = (event: MouseEvent) => {
  if (event.target instanceof Element && event.target.closest('[data-card]')) {
    event.preventDefault()
  }
}

let release: number | undefined

function hold() {
  window.clearTimeout(release)
  window.addEventListener('click', swallow, true)
}

function letGo() {
  window.clearTimeout(release)
  release = window.setTimeout(stop, 50)
}

function stop() {
  window.clearTimeout(release)
  window.removeEventListener('click', swallow, true)
}

const MONITOR = { onDragStart: hold, onDragEnd: letGo, onDragCancel: letGo }
