// @vitest-environment jsdom
/**
 * Timer on a ticket (#266):: starting, stopping, and logging more time while
 * preserving the current ticket state.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TimerRead } from '@/api/generated/models'
import { localToday } from '@/tickets/dueDate'
import { TimerProvider } from '@/tickets/timer/TimerProvider'
import { useTimer } from '@/tickets/timer/useTimer'

const mocks = vi.hoisted(() => ({
  query: { data: null as TimerRead | null, isSuccess: true, dataUpdatedAt: Date.now() },
  start: { mutateAsync: vi.fn(), isPending: false },
  stop: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  create: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock(
  '@/api/generated/endpoints/worklogs/worklogs',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/api/generated/endpoints/worklogs/worklogs')
    >()),
    useMyTimerMeTimerGet: () => mocks.query,
    useStartTimerTicketsTicketIdTimerPost: () => mocks.start,
    useStopTimerMeTimerDelete: () => mocks.stop,
    useUpdateTimerMeTimerPatch: () => mocks.update,
    useLogTimeTicketsTicketIdWorklogsPost: () => mocks.create,
  }),
)

function timer(overrides: Partial<TimerRead> = {}): TimerRead {
  return {
    ticket_id: 9,
    ticket_identifier: 'ENG-9',
    ticket_team_key: 'ENG',
    ticket_number: 9,
    started_at: '2026-10-02T12:00:00Z',
    duration_seconds: 90 * 60,
    is_paused: false,
    created_at: '2026-10-02T12:00:00Z',
    updated_at: '2026-10-02T12:00:00Z',
    ...overrides,
  }
}

function StartButton() {
  const active = useTimer()
  return (
    <button onClick={() => active.handleStartTimer(10, 'ENG-10')}>
      Start another ticket
    </button>
  )
}

function renderProvider(children = <StartButton />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TimerProvider>{children}</TimerProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.query.data = null
  mocks.query.dataUpdatedAt = Date.now()
  for (const request of [mocks.start, mocks.stop, mocks.update, mocks.create]) {
    request.mutateAsync.mockReset().mockResolvedValue({})
  }
})

afterEach(cleanup)

describe('TimerProvider', () => {
  it('shows the running timer as a movable floating pill', async () => {
    mocks.query.data = timer()
    renderProvider(<div />)
    const pill = screen.getByRole('link', { name: 'ENG-9' }).parentElement!

    expect(pill.className).toContain('fixed')
    expect(screen.getByRole('button', { name: 'Move timer' })).toBeTruthy()
  })

  it('stops into an editable log form and saves an ordinary worklog', async () => {
    mocks.query.data = timer()
    mocks.stop.mutateAsync.mockResolvedValue(timer())
    const user = renderProvider(<div />)

    expect(screen.getByRole('link', { name: 'ENG-9' }).getAttribute('href')).toBe(
      '/ENG/ticket/9',
    )
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Log time for ENG-9',
    })
    expect(screen.getByDisplayValue('1h 30m')).toBeTruthy()
    expect(screen.getByDisplayValue(localToday())).toBeTruthy()

    await user.clear(screen.getByDisplayValue('1h 30m'))
    await user.type(screen.getByPlaceholderText('2h 30m'), '2h')
    await user.type(
      screen.getByPlaceholderText('Debugging the webhook retry'),
      'pairing',
    )
    await user.click(screen.getByRole('button', { name: 'Log' }))

    await waitFor(() =>
      expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
        ticketId: 9,
        data: { minutes: 120, worked_on: localToday(), note: 'pairing' },
      }),
    )
    expect(dialog.isConnected).toBe(false)
  })

  it('logs the replaced timer before starting the new timer', async () => {
    const previous = timer({ duration_seconds: 75 * 60 })
    mocks.query.data = previous
    mocks.start.mutateAsync.mockResolvedValue({
      ...timer({ ticket_id: 10 }),
      replaced: previous,
    })
    const user = renderProvider()

    await user.click(
      screen.getByRole('button', { name: 'Start another ticket' }),
    )
    expect(
      await screen.findByRole('dialog', {
        name: 'Start a timer on ENG-10?',
      }),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Your timer on ENG-9 has 1h 15m on it. There is one timer per person.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole('radio', {
        name: 'Log 1h 15m on ENG-9, then start',
      }),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Start on ENG-10' }))
    expect(
      await screen.findByRole('dialog', { name: 'Log time for ENG-9' }),
    ).toBeTruthy()
    expect(screen.getByDisplayValue('1h 15m')).toBeTruthy()
    expect(mocks.start.mutateAsync).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Log' }))
    await waitFor(() =>
      expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
        ticketId: 9,
        data: { minutes: 75, worked_on: localToday(), note: undefined },
      }),
    )
    await waitFor(() =>
      expect(mocks.start.mutateAsync).toHaveBeenCalledWith({ ticketId: 10 }),
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('starts the new timer without opening a worklog when discard is selected', async () => {
    const previous = timer({ duration_seconds: 75 * 60 })
    mocks.query.data = previous
    mocks.start.mutateAsync.mockResolvedValue({
      ...timer({ ticket_id: 10 }),
      replaced: previous,
    })
    const user = renderProvider()

    await user.click(
      screen.getByRole('button', { name: 'Start another ticket' }),
    )
    await user.click(screen.getByRole('radio', { name: 'Discard it, then start' }))
    await user.click(screen.getByRole('button', { name: 'Start on ENG-10' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).toBeNull(),
    )
    expect(mocks.start.mutateAsync).toHaveBeenCalledWith({ ticketId: 10 })
  })

  it('shows the recovery form when a timer reaches ten hours', async () => {
    mocks.query.data = timer({ duration_seconds: 10 * 60 * 60 + 1 })
    mocks.stop.mutateAsync.mockImplementation(async () => {
      mocks.query.data = null
      return {}
    })
    const user = renderProvider(<div />)
    expect(
      await screen.findByRole('dialog', {
        name: 'Your timer on ENG-9 ran for 10 hours',
      }),
    ).toBeTruthy()
    expect(mocks.stop.mutateAsync).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('10h')).toBeTruthy()
    expect(screen.getByDisplayValue('2026-10-02')).toBeTruthy()
    expect(
      screen.getByText(/It was started .* at .* and never stopped/),
    ).toBeTruthy()
    expect(
      screen.queryByPlaceholderText('Debugging the webhook retry'),
    ).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Log time' }))
    await waitFor(() => expect(mocks.stop.mutateAsync).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
        ticketId: 9,
        data: { minutes: 600, worked_on: '2026-10-02', note: undefined },
      }),
    )
    expect(mocks.stop.mutateAsync).toHaveBeenCalledTimes(1)
    expect(mocks.create.mutateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.stop.mutateAsync.mock.invocationCallOrder[0],
    )
  })

  it('stops a forgotten timer when its worklog is discarded', async () => {
    mocks.query.data = timer({ duration_seconds: 10 * 60 * 60 + 1 })
    mocks.stop.mutateAsync.mockImplementation(async () => {
      mocks.query.data = null
      return {}
    })
    const user = renderProvider(<div />)

    const dialog = await screen.findByRole('dialog', {
      name: 'Your timer on ENG-9 ran for 10 hours',
    })
    await user.click(screen.getByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(mocks.stop.mutateAsync).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(dialog.isConnected).toBe(false))
    expect(mocks.create.mutateAsync).not.toHaveBeenCalled()
  })

  it('does not show the recovery form at exactly ten hours', () => {
    mocks.query.data = timer({ duration_seconds: 10 * 60 * 60 })
    renderProvider(<div />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
