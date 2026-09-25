// @vitest-environment jsdom
/**
 * The calendar (#105): issues on their due days, overflow, the keyboard, and
 * the month in the URL.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IssueRead, StatusRead } from '@/api/generated/models'
import { CalendarView } from '@/calendar/CalendarView'
import { TeamProvider } from '@/team/TeamContext'
import type { TeamContextValue } from '@/team/useTeamContext'

const mocks = vi.hoisted(() => ({
  params: [] as unknown[],
  items: [] as unknown[],
  update: { mutateAsync: vi.fn() },
}))

vi.mock('@/api/generated/endpoints/issues/issues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/issues/issues')>()),
  useListIssuesTeamsTeamIdIssuesGet: (...args: unknown[]) => {
    mocks.params = args
    return { data: { items: mocks.items, total: mocks.items.length }, isLoading: false }
  },
  useUpdateIssueIssuesIssueIdPatch: () => mocks.update,
}))

const TODO: StatusRead = { id: 1, team_id: 7, name: 'Todo', category: 'unstarted', position: 0, color: '#888' }
const TEAM: TeamContextValue = {
  team: { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' },
  teams: [],
  projects: [],
  labels: [],
  members: [],
  cycles: [],
  statuses: [TODO],
}

function issue(number: number, due_date: string, title = `Issue ${number}`): IssueRead {
  return {
    id: number,
    number,
    identifier: `ENG-${number}`,
    title,
    due_date,
    status: TODO,
  } as unknown as IssueRead
}

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.search}</output>
}

function renderCalendar(url = '/ENG?month=2026-09', canWrite = true) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamProvider value={TEAM}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route
              path="/ENG"
              element={
                <>
                  <CalendarView params={{ priority: 'high' }} canWrite={canWrite} />
                  <Where />
                </>
              }
            />
            <Route path="/ENG/issue/:n" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </TeamProvider>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const where = () => screen.getByTestId('where').textContent

beforeEach(() => {
  mocks.items = [
    issue(1, '2026-09-15', 'Ship the retry fix'),
    ...[2, 3, 4, 5].map((n) => issue(n, '2026-09-30')),
  ]
})

afterEach(cleanup)

describe('CalendarView', () => {
  it('asks for the days the grid shows, with the board filters', () => {
    renderCalendar()
    expect(mocks.params[1]).toMatchObject({
      priority: 'high',
      due_from: '2026-08-31',
      due_to: '2026-10-04',
    })
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeTruthy()
  })

  it('puts each issue on its due day', () => {
    renderCalendar()
    const day = screen.getByRole('gridcell', { name: /Tuesday 15 September, 1 due/ })
    expect(within(day).getByText('Ship the retry fix')).toBeTruthy()
  })

  it('shows three a day and counts the rest, which Enter or the count opens', async () => {
    const user = renderCalendar()
    const day = screen.getByRole('gridcell', { name: /Wednesday 30 September, 4 due/ })
    expect(within(day).getAllByRole('button', { name: /ENG-/ })).toHaveLength(3)

    await user.click(within(day).getByRole('button', { name: '+1 more' }))
    const dialog = screen.getByRole('dialog', { name: 'Due Wednesday 30 September' })
    expect(within(dialog).getAllByRole('button', { name: /ENG-/ })).toHaveLength(4)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    day.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'Due Wednesday 30 September' })).toBeTruthy()
  })

  it('opens an issue from its chip', async () => {
    const user = renderCalendar()
    await user.click(screen.getByRole('button', { name: /Ship the retry fix/ }))
    expect(where()).toBe('/ENG/issue/1')
  })

  it('moves by day with the arrows, into the next month when the month ends', async () => {
    const user = renderCalendar()
    const last = screen.getByRole('gridcell', { name: /Wednesday 30 September/ })
    last.focus()
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement?.getAttribute('data-day')).toBe('2026-09-23')

    await user.keyboard('{ArrowDown}{ArrowRight}')
    expect(document.activeElement?.getAttribute('data-day')).toBe('2026-10-01')
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeTruthy()
    expect(where()).toBe('/ENG?month=2026-10')
  })

  it('gives the grid exactly one day to Tab into', () => {
    renderCalendar()
    const tabbable = screen.getAllByRole('gridcell').filter((cell) => cell.tabIndex === 0)
    expect(tabbable).toHaveLength(1)
  })

  it('pages months with the buttons and keeps the rest of the URL', async () => {
    const user = renderCalendar('/ENG?priority=high&month=2026-09')
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(where()).toBe('/ENG?priority=high&month=2026-10')
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(where()).toBe('/ENG?priority=high&month=2026-08')
  })

  it('offers guests nothing to drag (#104)', () => {
    renderCalendar('/ENG?month=2026-09', false)
    const chip = screen.getByRole('button', { name: /Ship the retry fix/ })
    expect(chip.getAttribute('aria-roledescription')).toBeNull()
  })
})
