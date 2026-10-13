// @vitest-environment jsdom
/**
 * Time estimates in hours (#268): the property beside the points, the bar of
 * logged against estimated, what is left when logging time, a sprint's or an
 * epic's totals, and the history lines.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TicketEventRead, TicketRead, TicketTimeEstimate } from '@/api/generated/models'
import { TimeRollupBlock } from '@/sprints/TimeRollup'
import { eventText } from '@/tickets/detail/history'
import { TicketProperties } from '@/tickets/detail/TicketProperties'
import { TimeSection } from '@/tickets/detail/TimeSection'
import { localToday } from '@/tickets/dueDate'
import { formatDuration, parseDuration } from '@/tickets/duration'

const H = 60
const ME = { id: 1, full_name: 'Daniel Okafor', avatar_color: '#123', is_active: true }

const mocks = vi.hoisted(() => ({
  time: { data: undefined as unknown },
  estimate: { data: undefined as unknown },
  create: { mutateAsync: vi.fn(), isPending: false },
  unit: 'both' as string | undefined,
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: ME }),
}))
vi.mock('@/api/generated/endpoints/worklogs/worklogs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/worklogs/worklogs')>()),
  useTicketTimeTicketsTicketIdWorklogsGet: () => mocks.time,
  useLogTimeTicketsTicketIdWorklogsPost: () => mocks.create,
}))
vi.mock('@/api/generated/endpoints/time-estimates/time-estimates', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/api/generated/endpoints/time-estimates/time-estimates')
  >()),
  useTicketTimeEstimateTicketsTicketIdTimeEstimateGet: () => mocks.estimate,
}))
vi.mock('@/team/useTeamContext', () => ({
  useTeamContext: () => ({
    team: { id: 7, key: 'ENG', name: 'Engineering', estimate_unit: mocks.unit },
    teams: [],
    members: [],
    labels: [],
    sprints: [],
    statuses: [{ id: 3, name: 'In Progress', category: 'started' }],
    projects: [],
  }),
}))

function estimate(over: Partial<TicketTimeEstimate> = {}): TicketTimeEstimate {
  return {
    estimated_minutes: 10 * H,
    logged_minutes: 7 * H,
    remaining_minutes: 3 * H,
    remaining_set: false,
    total: { estimated_minutes: 10 * H, logged_minutes: 7 * H, remaining_minutes: 3 * H },
    subticket_count: 0,
    ...over,
  }
}

function wrap(children: ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.time.data = { total_minutes: 7 * H, by_person: [{ user: ME, minutes: 7 * H }], entries: [] }
  mocks.estimate.data = estimate()
  mocks.unit = 'both'
  mocks.create.mutateAsync.mockReset().mockResolvedValue({})
})

afterEach(cleanup)

describe('the Time section', () => {
  it('shows logged against estimated, what is left, and how far along', () => {
    wrap(<TimeSection ticketId={9} readOnly={false} />)
    expect(screen.getByText('7h logged of 10h · 3h left')).toBeTruthy()
    const bar = screen.getByRole('progressbar', { name: 'Time logged against the estimate' })
    expect(bar.getAttribute('aria-valuenow')).toBe(String(7 * H))
    expect(screen.getByText('70%')).toBeTruthy()
    expect(screen.queryByText(/over by/)).toBeNull()
  })

  it('says in words when it is over, not by colour alone', () => {
    mocks.estimate.data = estimate({
      estimated_minutes: 6 * H,
      logged_minutes: 10 * H,
      remaining_minutes: 0,
      total: { estimated_minutes: 6 * H, logged_minutes: 10 * H, remaining_minutes: 0 },
    })
    wrap(<TimeSection ticketId={9} readOnly={false} />)
    expect(screen.getByText('over by 4h')).toBeTruthy()
    expect(screen.getByText('10h logged of 6h · 0h left')).toBeTruthy()
  })

  it('adds the sub-tickets, and says so', () => {
    mocks.estimate.data = estimate({
      subticket_count: 2,
      total: { estimated_minutes: 20 * H, logged_minutes: 9 * H, remaining_minutes: 11 * H },
    })
    wrap(<TimeSection ticketId={9} readOnly={false} />)
    expect(screen.getByText('9h logged of 20h · 11h left, with sub-tickets')).toBeTruthy()
  })

  it('looks as it did for a ticket with no time estimate', () => {
    mocks.estimate.data = estimate({
      estimated_minutes: null,
      remaining_minutes: null,
      total: { estimated_minutes: 0, logged_minutes: 7 * H, remaining_minutes: 0 },
    })
    const user = wrap(<TimeSection ticketId={9} readOnly={false} />)
    expect(screen.getByText('7h logged')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
    return user.click(screen.getByRole('button', { name: /Log time/ })).then(() => {
      expect(screen.queryByText('How much is left?')).toBeNull()
    })
  })
})

describe('logging time asks what is left', () => {
  it('works the answer out as the time is typed, and leaves it to the server', async () => {
    const user = wrap(<TimeSection ticketId={9} readOnly={false} />)
    await user.click(screen.getByRole('button', { name: /Log time/ }))
    const left = screen.getByLabelText<HTMLInputElement>('How much is left?')
    expect(left.value).toBe('3h')
    await user.type(screen.getByPlaceholderText('2h 30m'), '3h')
    expect(left.value).toBe('0h')
    expect(
      screen.getByText(
        'Worked out as 0h: 10h estimated, 10h logged with this. Change it if there is more to do.',
      ),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Log' }))
    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      ticketId: 9,
      data: { minutes: 3 * H, worked_on: localToday(), note: undefined },
    })
  })

  it('sends what somebody changed it to', async () => {
    const user = wrap(<TimeSection ticketId={9} readOnly={false} />)
    await user.click(screen.getByRole('button', { name: /Log time/ }))
    await user.type(screen.getByPlaceholderText('2h 30m'), '3h')
    const left = screen.getByLabelText('How much is left?')
    await user.clear(left)
    await user.type(left, '1h')
    await user.click(screen.getByRole('button', { name: 'Log' }))
    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      ticketId: 9,
      data: { minutes: 3 * H, worked_on: localToday(), note: undefined, remaining_minutes: H },
    })
  })

  it('takes nothing left as an answer', async () => {
    const user = wrap(<TimeSection ticketId={9} readOnly={false} />)
    await user.click(screen.getByRole('button', { name: /Log time/ }))
    await user.type(screen.getByPlaceholderText('2h 30m'), '1h')
    const left = screen.getByLabelText('How much is left?')
    await user.clear(left)
    await user.type(left, '0')
    await user.click(screen.getByRole('button', { name: 'Log' }))
    expect(mocks.create.mutateAsync.mock.calls[0][0].data.remaining_minutes).toBe(0)
  })

  it('works down from a remaining somebody set by hand', async () => {
    mocks.estimate.data = estimate({ remaining_minutes: 5 * H, remaining_set: true })
    const user = wrap(<TimeSection ticketId={9} readOnly={false} />)
    await user.click(screen.getByRole('button', { name: /Log time/ }))
    await user.type(screen.getByPlaceholderText('2h 30m'), '2h')
    expect(screen.getByLabelText<HTMLInputElement>('How much is left?').value).toBe('3h')
    expect(screen.getByText(/5h was left, less this/)).toBeTruthy()
  })

  it('refuses something that is not a duration', async () => {
    const user = wrap(<TimeSection ticketId={9} readOnly={false} />)
    await user.click(screen.getByRole('button', { name: /Log time/ }))
    await user.type(screen.getByPlaceholderText('2h 30m'), '1h')
    const left = screen.getByLabelText('How much is left?')
    await user.clear(left)
    await user.type(left, 'soon')
    await user.click(screen.getByRole('button', { name: 'Log' }))
    expect(screen.getByText('Try something like 3h, 1h 30m or 0.')).toBeTruthy()
    expect(mocks.create.mutateAsync).not.toHaveBeenCalled()
  })
})

describe('the properties', () => {
  const ticket = (over: Partial<TicketRead> = {}) =>
    ({
      id: 9,
      status: { id: 3, name: 'In Progress', category: 'started' },
      priority: 'no_priority',
      type: 'story',
      estimate: 5,
      time_estimate_minutes: 10 * H,
      ...over,
    }) as TicketRead

  function renderProperties(t: TicketRead, patch = vi.fn().mockResolvedValue(undefined)) {
    const user = wrap(
      <TicketProperties
        ticket={t}
        patch={patch}
        currentLabelIds={new Set()}
        onToggleLabel={() => {}}
      />,
    )
    return { user, patch }
  }

  it('puts the time estimate beside the points for a team that estimates in both', () => {
    renderProperties(ticket())
    expect(screen.getByText('Estimate')).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>('Time estimate').value).toBe('10h')
  })

  it('changes nothing for a team that estimates in points', () => {
    mocks.unit = undefined
    renderProperties(ticket({ time_estimate_minutes: null }))
    expect(screen.getByText('Estimate')).toBeTruthy()
    expect(screen.queryByLabelText('Time estimate')).toBeNull()
  })

  it('shows only hours for a team that estimates in hours', () => {
    mocks.unit = 'hours'
    renderProperties(ticket({ estimate: null }))
    expect(screen.queryByText('Estimate')).toBeNull()
    expect(screen.getByLabelText('Time estimate')).toBeTruthy()
  })

  it('saves what is typed, in minutes, and clears it when emptied', async () => {
    const { user, patch } = renderProperties(ticket({ time_estimate_minutes: null }))
    const field = screen.getByLabelText('Time estimate')
    await user.type(field, '2h 30m{Enter}')
    expect(patch).toHaveBeenCalledWith({ time_estimate_minutes: 150 })
    cleanup()
    const again = renderProperties(ticket())
    await again.user.clear(screen.getByLabelText('Time estimate'))
    await again.user.tab()
    expect(again.patch).toHaveBeenCalledWith({ time_estimate_minutes: null })
  })

  it('does not save what is not a duration', async () => {
    const { user, patch } = renderProperties(ticket({ time_estimate_minutes: null }))
    const field = screen.getByLabelText('Time estimate')
    await user.type(field, 'a while{Enter}')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(patch).not.toHaveBeenCalled()
  })
})

describe('a sprint and an epic add up', () => {
  it('shows estimated, logged and remaining, and labels a ticket that is over', () => {
    wrap(
      <TimeRollupBlock
        title="The sprint"
        after="4 days to go"
        rollup={{
          estimated_minutes: 96 * H,
          logged_minutes: 61 * H,
          remaining_minutes: 35 * H,
          over: [
            {
              id: 22,
              team_key: 'ENG',
              number: 22,
              identifier: 'ENG-22',
              title: 'Totals round differently',
              estimated_minutes: 6 * H,
              logged_minutes: 10 * H,
              remaining_minutes: 0,
            },
          ],
        }}
      />,
    )
    expect(screen.getByText('61h of 96h')).toBeTruthy()
    expect(screen.getByText('35h left · 4 days to go')).toBeTruthy()
    const over = screen.getByRole('list', { name: 'Over their estimate' })
    expect(over.textContent).toContain('ENG-22 Totals round differently')
    expect(over.textContent).toContain('over by 4h')
    expect(over.textContent).toContain('10h of 6h')
    expect(screen.getByRole('link').getAttribute('href')).toBe('/ENG/ticket/22')
  })
})

describe('the history and the arithmetic', () => {
  const event = (field: TicketEventRead['field'], from: string | null, to: string | null) =>
    ({
      id: 1,
      field,
      old_value: from,
      new_value: to,
      created_at: '2026-10-01T10:00:00',
    }) as TicketEventRead

  it('says what happened to a time estimate and to what is left', () => {
    expect(eventText(event('time_estimate', null, '600'))).toBe(
      'Automation set the time estimate to 10h',
    )
    expect(eventText(event('time_estimate', '600', '450'))).toBe(
      'Automation changed the time estimate from 10h to 7h 30m',
    )
    expect(eventText(event('remaining', null, '0'))).toBe('Automation said 0h is left')
    expect(eventText(event('remaining', '120', null))).toBe(
      'Automation left what is left to be worked out (was 2h)',
    )
  })

  it('reads nothing left as a duration only where it is allowed', () => {
    expect(parseDuration('0')).toBeNull()
    expect(parseDuration('0h', { allowZero: true })).toBe(0)
    expect(parseDuration('0', { allowZero: true })).toBe(0)
    expect(formatDuration(0)).toBe('0h')
  })
})
