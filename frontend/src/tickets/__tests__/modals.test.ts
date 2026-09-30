/**
 * The linked-ticket modals open over a ticket, as its history entry holds
 * them (#114): read defensively, since the browser keeps whatever was put
 * there, and written without losing the rest of the entry.
 */
import type { Query } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { aboutTicket, MAX_MODAL_DEPTH, modalsIn, withModal } from '@/tickets/modals'

const BLOCKER = { id: 250, team_key: 'ENG', number: 25, identifier: 'ENG-25' }
const CHILD = { id: 120, team_key: 'ENG', number: 12, identifier: 'ENG-12' }

describe('modalsIn', () => {
  it('reads the modals an entry holds, bottom first', () => {
    expect(modalsIn({ ticketModals: [BLOCKER, CHILD] })).toEqual([BLOCKER, CHILD])
  })

  it('reads none from an entry without any: a pasted link, the panel, the board', () => {
    expect(modalsIn(null)).toEqual([])
    expect(modalsIn(undefined)).toEqual([])
    expect(modalsIn({ ticketSurface: 'panel' })).toEqual([])
    expect(modalsIn({ ticketModals: [] })).toEqual([])
  })

  it('reads none from anything it does not recognise, rather than a stack with a hole in it', () => {
    expect(modalsIn({ ticketModals: 'ENG-25' })).toEqual([])
    expect(modalsIn({ ticketModals: [BLOCKER, { id: 'x' }] })).toEqual([])
    expect(modalsIn({ ticketModals: [BLOCKER, null] })).toEqual([])
    expect(modalsIn({ ticketModals: [{ ...BLOCKER, number: 2.5 }] })).toEqual([])
  })

  it('never reads deeper than the cap', () => {
    const three = [BLOCKER, CHILD, { ...CHILD, id: 90, number: 9, identifier: 'ENG-9' }]
    expect(modalsIn({ ticketModals: three })).toHaveLength(MAX_MODAL_DEPTH)
  })

  it('gives the same empty list every time, so it can sit in a dependency list', () => {
    expect(modalsIn(null)).toBe(modalsIn({}))
  })
})

describe('withModal', () => {
  it('puts one more modal on top, keeping the rest of the entry', () => {
    const board = { view: 'list', search: 'retry' }
    const state = withModal({ ticketSurface: 'panel', board, ticketModals: [BLOCKER] }, CHILD)
    expect(state).toEqual({ ticketSurface: 'panel', board, ticketModals: [BLOCKER, CHILD] })
  })

  it('starts a stack on an entry with no state at all', () => {
    expect(withModal(null, BLOCKER)).toEqual({ ticketModals: [BLOCKER] })
  })

  it('stores only what an entry needs of the ticket, not the whole of it', () => {
    const linked = { ...BLOCKER, title: 'Per-team custom statuses', status: { name: 'Todo' } }
    expect(withModal(null, linked)).toEqual({ ticketModals: [BLOCKER] })
  })
})

describe('aboutTicket', () => {
  const query = (path: string) => ({ queryKey: [path, { limit: 100 }] }) as unknown as Query

  it('matches a ticket and everything under it', () => {
    const about = aboutTicket(20)
    expect(about(query('/tickets/20'))).toBe(true)
    expect(about(query('/tickets/20/links'))).toBe(true)
    expect(about(query('/tickets/20/events'))).toBe(true)
  })

  it('matches no other ticket, however alike the number', () => {
    const about = aboutTicket(20)
    expect(about(query('/tickets/2'))).toBe(false)
    expect(about(query('/tickets/200'))).toBe(false)
    expect(about(query('/teams/20/tickets'))).toBe(false)
  })
})
