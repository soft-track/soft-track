// @vitest-environment jsdom
/**
 * One address per ticket, two surfaces (#112): the location state says which,
 * and going to a ticket from inside one -- where it moved to -- stays on the
 * surface it is on. A ticket it merely names opens in a modal instead (#114;
 * see TicketStack.test.tsx).
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import {
  type TicketSurface,
  TicketSurfaceContext,
  ticketPath,
  surfaceFor,
  useOpenTicketHere,
} from '@/tickets/surface'

afterEach(cleanup)

describe('surfaceFor', () => {
  it('is the panel only when the location asks for it', () => {
    expect(surfaceFor({ ticketSurface: 'panel' })).toBe('panel')
  })

  it('is the page for anything else: a pasted link has no state at all', () => {
    expect(surfaceFor(null)).toBe('page')
    expect(surfaceFor(undefined)).toBe('page')
    expect(surfaceFor({})).toBe('page')
    expect(surfaceFor({ ticketSurface: 'modal' })).toBe('page')
    expect(surfaceFor('panel')).toBe('page')
  })
})

it('builds the one address a ticket has', () => {
  expect(ticketPath({ team_key: 'ENG', number: 42 })).toBe('/ENG/ticket/42')
})

/** What a ticket moved to another team does: its new address, on the same surface. */
function FollowTheMove() {
  const open = useOpenTicketHere()
  return (
    <button type="button" onClick={() => open({ team_key: 'OPS', number: 7 })}>
      Go to its new address
    </button>
  )
}

function Where() {
  const location = useLocation()
  return (
    <output data-surface={surfaceFor(location.state)}>{location.pathname}</output>
  )
}

function renderInside(surface?: TicketSurface) {
  const opener = surface ? (
    <TicketSurfaceContext.Provider value={surface}>
      <FollowTheMove />
    </TicketSurfaceContext.Provider>
  ) : (
    <FollowTheMove />
  )
  render(
    <MemoryRouter initialEntries={['/ENG/ticket/42']}>
      <Routes>
        <Route path="/ENG/ticket/42" element={opener} />
        <Route path="/OPS/ticket/:n" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('useOpenTicketHere', () => {
  it('keeps a ticket followed from the panel in the panel', async () => {
    renderInside('panel')
    await userEvent.click(screen.getByRole('button', { name: 'Go to its new address' }))
    const where = screen.getByRole('status')
    expect(where.textContent).toBe('/OPS/ticket/7')
    expect(where.dataset.surface).toBe('panel')
  })

  it('keeps a ticket followed from the page on a page', async () => {
    renderInside('page')
    await userEvent.click(screen.getByRole('button', { name: 'Go to its new address' }))
    expect(screen.getByRole('status').dataset.surface).toBe('page')
  })

  it('opens the page from outside any surface', async () => {
    renderInside()
    await userEvent.click(screen.getByRole('button', { name: 'Go to its new address' }))
    expect(screen.getByRole('status').dataset.surface).toBe('page')
  })
})
