import type { Query } from '@tanstack/react-query'

/**
 * Linked tickets, opened in modals over the ticket you are reading (#114).
 *
 * Following a blocker, a sub-ticket or the parent used to navigate, and the
 * ticket you were reading went with it: its scroll position, a half-written
 * comment, and the way back, which was Back once per hop. But looking at a
 * blocker is a question asked about this ticket -- is that one done yet? --
 * so it opens in a modal above it instead, and this one is never left.
 *
 * The modals open over a ticket live in the history entry, the way the panel
 * or page choice does (surface.ts). The address stays the ticket's own, and
 * each modal is one entry pushed over it, so Back closes the top modal
 * rather than leaving the ticket. Closing one any other way goes back that
 * one entry too, which keeps the history free of modals nobody can see.
 *
 * Pure so it can be tested without React.
 */

/**
 * How deep modals stack. A link followed from the deepest one opens its
 * ticket's page (#112) rather than a third scrim over a second.
 */
export const MAX_MODAL_DEPTH = 2

/**
 * One open modal: the ticket, and enough to name it and find its page before
 * it has loaded. A link row, a sub-ticket and a parent all carry this much.
 */
export type TicketModalEntry = {
  id: number
  team_key: string
  number: number
  identifier: string
}

const NONE: readonly TicketModalEntry[] = Object.freeze([])

function isEntry(value: unknown): value is TicketModalEntry {
  const entry = value as Partial<TicketModalEntry> | null
  return (
    typeof entry === 'object' &&
    entry !== null &&
    Number.isInteger(entry.id) &&
    typeof entry.team_key === 'string' &&
    Number.isInteger(entry.number) &&
    typeof entry.identifier === 'string'
  )
}

/**
 * The modals open at a history entry, bottom first. The state is whatever
 * the browser kept, so anything unrecognisable reads as none: a stack with a
 * hole in it would open a modal over the wrong ticket.
 */
export function modalsIn(state: unknown): readonly TicketModalEntry[] {
  const modals = (state as { ticketModals?: unknown } | null)?.ticketModals
  if (!Array.isArray(modals) || modals.length === 0 || !modals.every(isEntry)) return NONE
  return modals.slice(0, MAX_MODAL_DEPTH)
}

/**
 * The state for a history entry with one more modal open than `state` has.
 * Everything else in it -- the panel's own flag, what the board saved for
 * Back -- is kept, and of the ticket only what an entry holds is stored.
 * Whether there is room for another is the caller's question.
 */
export function withModal(state: unknown, ticket: TicketModalEntry): Record<string, unknown> {
  const { id, team_key, number, identifier } = ticket
  return {
    ...(state !== null && typeof state === 'object' ? state : {}),
    ticketModals: [...modalsIn(state), { id, team_key, number, identifier }],
  }
}

/**
 * Every cached query about one ticket: itself, and its links, events,
 * comments and so on under it. What a modal refreshes for the ticket
 * underneath when it closes, since what changed up there shows down there --
 * a blocker's status on a link row, a sub-ticket in the parent's progress.
 */
export function aboutTicket(id: number): (query: Query) => boolean {
  const root = `/tickets/${id}`
  return (query) => {
    const path = String(query.queryKey[0] ?? '')
    return path === root || path.startsWith(`${root}/`)
  }
}
