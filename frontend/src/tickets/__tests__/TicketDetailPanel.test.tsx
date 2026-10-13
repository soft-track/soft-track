// @vitest-environment jsdom
/**
 * The panel is chrome around the shared body (#112): its own header, close
 * button and keys, and a way out to the ticket's page. A ticket it links to
 * opens in a modal over it (#114); see TicketStack.test.tsx.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TicketRead } from '@/api/generated/models'
import { TicketDetailPanel } from '@/tickets/TicketDetailPanel'
import { surfaceFor } from '@/tickets/surface'

const TICKET = {
  id: 70,
  team_id: 5,
  team_key: 'ENG',
  number: 7,
  identifier: 'ENG-7',
  title: 'Retry storm',
  status: { id: 1, team_id: 5, name: 'Todo', category: 'unstarted', position: 0, color: '#888' },
} as unknown as TicketRead

vi.mock('@/api/generated/endpoints/tickets/tickets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/tickets/tickets')>()),
  useGetTicketTicketsTicketIdGet: () => ({ data: TICKET }),
}))

vi.mock('@/tickets/TicketHeaderActions', () => ({ TicketHeaderActions: () => null }))

vi.mock('@/tickets/TicketDetailBody', () => ({
  TicketDetailBody: ({ ticketId }: { ticketId: number }) => <p>Body for ticket {ticketId}</p>,
}))

/** The panel while the address asks for it, as TeamRoute has it; the page's stand-in otherwise. */
function PanelOrPage(props: { onClose: () => void; openPage?: () => void }) {
  const location = useLocation()
  if (surfaceFor(location.state) === 'page') return <p>The page for {location.pathname}</p>
  return <TicketDetailPanel ticketId={70} {...props} />
}

function renderPanel(onClose = vi.fn(), openPage?: () => void) {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[{ pathname: '/ENG/ticket/7', state: { ticketSurface: 'panel' } }]}>
        <Routes>
          <Route
            path="/ENG/ticket/7"
            element={<PanelOrPage onClose={onClose} openPage={openPage} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onClose, container }
}

afterEach(cleanup)

describe('the ticket panel', () => {
  it('puts its own header over the shared body', () => {
    renderPanel()
    expect(screen.getByRole('dialog', { name: 'ENG-7 Retry storm' })).toBeTruthy()
    expect(screen.getByText('Body for ticket 70')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('closes on Escape', async () => {
    const { onClose } = renderPanel()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('opening the panel’s ticket as a page', () => {
  it('is a link to the page, which a middle click opens in a new tab', () => {
    renderPanel()
    const link = screen.getByRole('link', { name: 'Open as page' })
    expect(link.getAttribute('href')).toBe('/ENG/ticket/7')
  })

  it('goes to the page on a plain click', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('link', { name: 'Open as page' }))
    expect(screen.getByText('The page for /ENG/ticket/7')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('leaves the going to the board, when the board has a way of its own', async () => {
    const openPage = vi.fn()
    renderPanel(vi.fn(), openPage)
    await userEvent.click(screen.getByRole('link', { name: 'Open as page' }))
    expect(openPage).toHaveBeenCalledTimes(1)
    expect(openPage).toHaveBeenCalledWith(TICKET)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('leaves a modified click to the browser', () => {
    const openPage = vi.fn()
    const { container } = renderPanel(vi.fn(), openPage)
    // Whether the click's default survived the panel's handler: read at the
    // root React listens on, and stopped there, since jsdom cannot follow it.
    let followed: boolean | undefined
    container.addEventListener('click', (event) => {
      followed = !event.defaultPrevented
      event.preventDefault()
    })
    fireEvent.click(screen.getByRole('link', { name: 'Open as page' }), { ctrlKey: true })

    expect(followed).toBe(true)
    expect(openPage).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
