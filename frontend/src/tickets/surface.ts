import { createContext, useCallback, useContext } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Which surface a ticket is shown on (#112).
 *
 * A ticket has one address -- /ENG/ticket/42, the link people paste -- and two
 * ways to be shown there: the panel, sliding over the board, for a glance from
 * the board or the list; and the page, standing alone, for everything else.
 * The address never says which. How you arrived does, in the location state:
 * the board and the list ask for the panel, and a pasted link, the command
 * palette, search and notifications arrive asking for nothing, and get the
 * page. A reload keeps whichever it was -- the state is part of the history
 * entry.
 *
 * A card and a list row are links to that address as well, so the browser's
 * own ways of following a link -- a middle click, "Open in new tab" -- also
 * arrive asking for nothing, and get the page.
 */
export type TicketSurface = 'panel' | 'page'

/** Enough of a ticket to find it by its address. */
export type TicketRef = { team_key: string; number: number }

export const ticketPath = (ticket: TicketRef) => `/${ticket.team_key}/ticket/${ticket.number}`

/**
 * A plain click: the main button, with no modifier held. On a link to a
 * ticket, that is the app's to answer. A click the app has no other use for --
 * ⌘ or Ctrl, Shift, Alt -- is left to the browser, which opens the link in a
 * new tab or window as it would any other.
 */
export function isPlainClick(event: {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}): boolean {
  return (
    event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
  )
}

/** The surface a location asks for. Anything but the panel's own state is the page. */
export function surfaceFor(state: unknown): TicketSurface {
  return (state as { ticketSurface?: unknown } | null)?.ticketSurface === 'panel' ? 'panel' : 'page'
}

/** Go to a ticket, on the surface given. */
export function useOpenTicket() {
  const navigate = useNavigate()
  return useCallback(
    (ticket: TicketRef, surface: TicketSurface) =>
      navigate(
        ticketPath(ticket),
        surface === 'panel' ? { state: { ticketSurface: 'panel' } } : undefined,
      ),
    [navigate],
  )
}

/**
 * The surface the ticket in front of you is on, set by that surface's chrome.
 *
 * Read by nothing but `useOpenRelatedTicket`: the sections below a surface's
 * header do not know where they are, they only ask it to open things.
 */
export const TicketSurfaceContext = createContext<TicketSurface>('page')

/**
 * Open a ticket this one names -- its parent, a sub-ticket, a linked ticket --
 * on the surface you are already on. Following a link from the panel stays
 * over the board, and from the page stays a page.
 */
export function useOpenRelatedTicket() {
  const surface = useContext(TicketSurfaceContext)
  const open = useOpenTicket()
  return useCallback((ticket: TicketRef) => open(ticket, surface), [open, surface])
}
