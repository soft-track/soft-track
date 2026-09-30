import { createContext, useContext } from 'react'

import type { TicketModalEntry } from '@/tickets/modals'
import { type TicketRef, useOpenTicketHere } from '@/tickets/surface'

/**
 * What following a ticket from a layer of the stack does (#114). Over it in
 * a modal while there is room; its page from the deepest modal; and back
 * down to it when it is already open beneath -- every link shows on both of
 * its tickets, so a blocker's modal lists the ticket it blocks, and that is
 * the one you were reading.
 */
export type RelatedOpens = 'modal' | 'page' | 'back'

/**
 * The stack a ticket's body sits in (#114): the panel or the page at the
 * bottom, and the linked tickets opened in modals over it. TicketStack gives
 * it; the sections that open other tickets read it through
 * `useRelatedTickets`, so none of them needs to know where it is.
 */
export interface TicketStackValue {
  /** The modals open over the bottom ticket, bottom first. */
  modals: readonly TicketModalEntry[]
  /** Follow `ticket` from layer `from`; a modal it opens puts focus back on `opener`. */
  open: (from: number, ticket: TicketModalEntry, opener: HTMLElement | null) => void
  /** What following the ticket `id` from layer `from` does. */
  opens: (from: number, id: number) => RelatedOpens
  /** Leave for a ticket's page (#112). */
  openPage: (ticket: TicketRef) => void
  /** The element a modal's focus goes back to when it closes, by its depth. */
  openerOf: (depth: number) => HTMLElement | null
}

export const TicketStackContext = createContext<TicketStackValue | null>(null)

/** The layer a ticket's body is in: 0 for the panel or the page, then 1, 2 for the modals over it. */
export const TicketLayerContext = createContext(0)

/**
 * Follow a ticket this one names -- a link, a sub-ticket, the parent -- from
 * wherever this one is, and say beforehand what that will do. Also which
 * ticket is open in the modal directly above this one, so the row it came
 * from can show it while the modal stands beside it.
 */
export function useRelatedTickets(): {
  open: (ticket: TicketModalEntry, opener?: HTMLElement | null) => void
  opens: (id: number) => RelatedOpens
  openAbove: number | null
} {
  const stack = useContext(TicketStackContext)
  const depth = useContext(TicketLayerContext)
  const openHere = useOpenTicketHere()

  // Outside any stack -- a section rendered on its own -- the ticket's
  // address is still somewhere to go.
  if (!stack) return { open: (ticket) => openHere(ticket), opens: () => 'page', openAbove: null }

  return {
    open: (ticket, opener) => stack.open(depth, ticket, opener ?? null),
    opens: (id) => stack.opens(depth, id),
    openAbove: stack.modals[depth]?.id ?? null,
  }
}
