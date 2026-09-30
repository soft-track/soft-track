// @vitest-environment jsdom
/**
 * Closing a modal goes back one history entry (#114), and in a browser that
 * lands later, not at once. Until it has, the modal being closed is still
 * what shows, and a second Escape must not go back past it: on a ticket page
 * opened from a chat, that would leave SoftTrack altogether.
 *
 * `navigate` is a spy here, so going back never lands -- which is the moment
 * in question. TicketStack.test.tsx covers what happens once it does.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

import type { TeamRead, TicketRead } from '@/api/generated/models'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'
import { TicketSurfaceContext } from '@/tickets/surface'
import { TicketStack } from '@/tickets/TicketStack'

const ENG: TeamRead = { id: 5, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' }
const READING = { id: 200, identifier: 'ENG-20', team_key: 'ENG', number: 20 } as TicketRead
const BLOCKER = { id: 250, team_key: 'ENG', number: 25, identifier: 'ENG-25' }

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/api/generated/endpoints/tickets/tickets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/tickets/tickets')>()),
  useGetTicketTicketsTicketIdGet: () => ({ data: undefined, error: null }),
}))

vi.mock('@/tickets/TicketDetailBody', () => ({
  TicketBodySkeleton: () => null,
  TicketDetailBody: () => null,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('goes back once for two quick Escapes, while the first is still on its way', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[{ pathname: '/ENG/ticket/20', state: { ticketModals: [BLOCKER] } }]}>
        <TeamProvider value={{ team: ENG, teams: [ENG] } as TeamContextValue}>
          <TicketSurfaceContext.Provider value="page">
            <TicketStack ticket={READING}>
              <main />
            </TicketStack>
          </TicketSurfaceContext.Provider>
        </TeamProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  await userEvent.keyboard('{Escape}{Escape}')

  expect(mocks.navigate).toHaveBeenCalledTimes(1)
  expect(mocks.navigate).toHaveBeenCalledWith(-1)
})
