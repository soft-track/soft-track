// @vitest-environment jsdom
/**
 * My time (#267): a week as a grid of tickets against days, across teams;
 * typing in a cell sets that day's time; a ticket joins the week by search;
 * a team's admins see its week as a row per person; marked days in words.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  MyTimesheet,
  PeopleTimesheet,
  TimesheetDay,
  TimesheetTicketRow,
} from '@/api/generated/models'
import TimesheetPage from '@/mywork/TimesheetPage'

const mocks = vi.hoisted(() => ({
  mine: vi.fn(),
  team: vi.fn(),
  reports: vi.fn(),
  save: vi.fn(),
  search: vi.fn(),
}))

vi.mock('@/api/generated/endpoints/timesheet/timesheet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/timesheet/timesheet')>()),
  useMyTimesheetMeWorklogsGet: (params: unknown) => mocks.mine(params),
  useTeamTimesheetTeamsTeamIdWorklogsGet: (teamId: number, params: unknown, options: unknown) =>
    mocks.team(teamId, params, options),
  useReportsTimesheetMeReportsWorklogsGet: (params: unknown, options: unknown) =>
    mocks.reports(params, options),
  useSetMyDayTicketsTicketIdWorklogsDaysWorkedOnPut: () => ({ mutateAsync: mocks.save }),
}))
vi.mock('@/api/generated/endpoints/search/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/search/search')>()),
  useSearchSearchGet: (params: unknown, options: unknown) => mocks.search(params, options),
}))

const STATUS = {
  id: 3,
  team_id: 7,
  name: 'In Progress',
  category: 'started',
  position: 2,
  color: '#f29d0b',
} as const

// Monday 28 September to Sunday 4 October 2026; today is Thursday.
const WEEK = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']
const TODAY = '2026-10-01'

function days(minutes: number[], marks: Partial<TimesheetDay>[] = []): TimesheetDay[] {
  return WEEK.map((day, index) => ({ day, minutes: minutes[index] ?? 0, ...marks[index] }))
}

function row(id: number, key: string, title: string, minutes: number[], canLog = true): TimesheetTicketRow {
  return {
    ticket: {
      id,
      team_id: key === 'ENG' ? 7 : 8,
      team_key: key,
      number: id,
      identifier: `${key}-${id}`,
      title,
      type: 'task',
      priority: 'high',
      status: STATUS,
      can_log: canLog,
    },
    days: WEEK.map((day, index) => ({ day, minutes: minutes[index] ?? 0 })),
    minutes: minutes.reduce((a, b) => a + b, 0),
  }
}

const ENG = { id: 7, key: 'ENG', name: 'Engineering' }

function mine(overrides: Partial<MyTimesheet> = {}): MyTimesheet {
  return {
    start: WEEK[0],
    end: WEEK[6],
    today: TODAY,
    long_day_minutes: 600,
    days: days([300, 465, 390, 0, 0], [{}, {}, {}, { nothing_logged: true }]),
    minutes: 1155,
    tickets: [
      row(9, 'ENG', 'Portal: sign-in with magic link', [240, 180, 120]),
      row(13, 'ENG', 'Rate-limit the public API', [120, 0, 210]),
      row(4, 'SUP', 'Acme cannot download invoices', [60], false),
    ],
    teams_i_run: [ENG],
    has_reports: false,
    ...overrides,
  }
}

const person = (id: number, full_name: string) => ({
  id,
  username: full_name.split(' ')[0].toLowerCase(),
  full_name,
  avatar_color: '#f2721c',
  is_active: true,
})

function teamWeek(): PeopleTimesheet {
  const ravi = person(3, 'Ravi Patel')
  const yuki = person(4, 'Yuki Sato')
  return {
    start: WEEK[0],
    end: WEEK[6],
    today: TODAY,
    long_day_minutes: 600,
    team: ENG,
    days: days(
      [600, 480, 960],
      [{}, { nothing_logged: true, people_without_time: [ravi] }, { over: true, people_over: [yuki] }],
    ),
    minutes: 2040,
    people: [
      { person: ravi, days: days([360, 0, 300]), minutes: 660 },
      { person: yuki, days: days([240, 480, 660]), minutes: 1380 },
    ],
  }
}

function Where() {
  const location = useLocation()
  return <output aria-label="where">{location.pathname + location.search}</output>
}

function renderPage(path = '/my-work/time') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Outlet context={{ openSidebar: () => {} }} />}>
            <Route
              path="/my-work/time"
              element={
                <>
                  <TimesheetPage />
                  <Where />
                </>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const loaded = (data: unknown) => ({ data, isPending: false, isError: false })

beforeEach(() => {
  mocks.mine.mockImplementation(() => loaded(mine()))
  mocks.team.mockImplementation(() => loaded(teamWeek()))
  mocks.reports.mockImplementation(() => loaded(undefined))
  mocks.search.mockImplementation(() => ({ data: { items: [] }, isLoading: false }))
  mocks.save.mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('My time', () => {
  it('shows the week as tickets against days, with totals and what is marked', () => {
    renderPage()

    // This week is the server's: no date is asked for.
    expect(mocks.mine).toHaveBeenCalledWith({ ticket_id: [] })
    expect(screen.getByText('28 Sep – 4 Oct 2026')).toBeTruthy()
    const headings = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    // A weekend with nothing on it is not shown.
    expect(headings).toEqual(['Ticket', 'Mon 28', 'Tue 29', 'Wed 30', 'Thu 1', 'Fri 2', 'Week'])

    const magic = screen.getByRole('row', { name: /Portal: sign-in with magic link/ })
    expect(within(magic).getByRole('textbox', { name: 'ENG-9 on Monday 28 September' })).toHaveProperty(
      'value',
      '4h',
    )
    expect(within(magic).getByText('9h')).toBeTruthy()
    const rate = screen.getByRole('row', { name: /Rate-limit/ })
    expect(within(rate).getByRole('textbox', { name: /on Wednesday/ })).toHaveProperty('value', '3h 30m')

    const total = screen.getByRole('row', { name: /^Total/ })
    expect(within(total).getByText('7h 45m')).toBeTruthy()
    expect(within(total).getByText('19h 15m')).toBeTruthy()
    // Thursday has started and has nothing: said in words, not colour alone.
    expect(screen.getByText('Thursday: nothing logged')).toBeTruthy()
  })

  it('logs what is typed in a cell, for that ticket and day', async () => {
    const user = renderPage()
    const cell = screen.getByRole('textbox', { name: 'ENG-13 on Tuesday 29 September' })

    await user.click(cell)
    await user.keyboard('2h 15m{Enter}')

    expect(mocks.save).toHaveBeenCalledWith({
      ticketId: 13,
      workedOn: '2026-09-29',
      data: { minutes: 135 },
    })
  })

  it('clears a day by emptying its cell, and refuses what is not a duration', async () => {
    const user = renderPage()
    const monday = screen.getByRole('textbox', { name: 'ENG-9 on Monday 28 September' })
    await user.clear(monday)
    await user.tab()
    expect(mocks.save).toHaveBeenCalledWith({
      ticketId: 9,
      workedOn: '2026-09-28',
      data: { minutes: 0 },
    })

    mocks.save.mockClear()
    const tuesday = screen.getByRole('textbox', { name: 'ENG-9 on Tuesday 29 September' })
    await user.clear(tuesday)
    await user.type(tuesday, 'lots{Enter}')
    expect(mocks.save).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('“lots” is not a duration')
  })

  it('leaves the days still to come, and a team I am a guest on, closed', () => {
    renderPage()
    expect(screen.getByRole('textbox', { name: 'ENG-9 on Friday 2 October' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.getByRole('textbox', { name: 'ENG-9 on Thursday 1 October' })).toHaveProperty(
      'disabled',
      false,
    )
    expect(screen.getByRole('textbox', { name: 'SUP-4 on Monday 28 September' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('adds a ticket to the week by searching for it', async () => {
    mocks.search.mockImplementation(() => ({
      data: {
        items: [
          {
            id: 10,
            identifier: 'ENG-10',
            title: 'Portal: invoice list page',
            status: STATUS,
            priority: 'medium',
            type: 'story',
            team_id: 7,
            team_key: 'ENG',
            number: 10,
            updated_at: '2026-09-30T10:00:00',
            matched_in: 'title',
            snippet: '',
          },
        ],
      },
      isLoading: false,
    }))
    const user = renderPage()

    await user.click(screen.getByRole('button', { name: 'Add a ticket' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search for a ticket' }), 'invoice')
    await user.click(await screen.findByRole('button', { name: /Portal: invoice list page/ }))

    expect(mocks.mine).toHaveBeenLastCalledWith({ ticket_id: [10] })
  })

  it('moves a week at a time, and back to this week', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(screen.getByLabelText('where').textContent).toBe('/my-work/time?from=2026-09-21')
    expect(mocks.mine).toHaveBeenLastCalledWith({
      from: '2026-09-21',
      to: '2026-09-27',
      ticket_id: [],
    })
  })
})

describe('A team’s week', () => {
  it('is a row per person for the team’s admins, with the days marked in words', () => {
    renderPage('/my-work/time?team=ENG')

    expect(mocks.team).toHaveBeenCalledWith(7, {}, { query: { enabled: true } })
    expect(screen.getByText('Engineering · This week')).toBeTruthy()
    const ravi = screen.getByRole('row', { name: /Ravi Patel/ })
    expect(within(ravi).getByText('11h')).toBeTruthy()
    // Nothing to type in: it is other people's time.
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.getByText('Tuesday: Ravi logged nothing')).toBeTruthy()
    expect(screen.getByText('Wednesday: Yuki logged more than 10 hours')).toBeTruthy()
  })

  it('is not offered on a team I do not run', () => {
    mocks.mine.mockImplementation(() => loaded(mine({ teams_i_run: [] })))
    renderPage('/my-work/time?team=ENG')
    expect(mocks.team).toHaveBeenCalledWith(0, {}, { query: { enabled: false } })
    expect(screen.getByRole('row', { name: /Rate-limit/ })).toBeTruthy()
  })
})
