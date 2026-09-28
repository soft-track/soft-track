// @vitest-environment jsdom
/**
 * A profile behind every name (#126): somebody else's, your own with a way
 * to edit it, a deactivated one that still resolves, and nobody at all.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProfileRead, WorkloadRead } from '@/api/generated/models'
import ProfilePage from '@/people/ProfilePage'

const mocks = vi.hoisted(() => ({
  profile: { isPending: false, isError: false, data: undefined as unknown },
  workload: { isPending: false, isError: false, data: undefined as unknown },
  me: { id: 1 },
}))

vi.mock('@/api/generated/endpoints/people/people', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/people/people')>()),
  useGetProfileUsersUsernameGet: () => mocks.profile,
  useGetWorkloadUsersUsernameWorkloadGet: () => mocks.workload,
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: mocks.me }),
}))

const SOFIA = {
  id: 9,
  username: 'sofia',
  full_name: 'Sofia Marquez',
  avatar_color: '#ef4444',
  is_active: true,
  job_title: 'Chief Operating Officer',
}

const AMINA: ProfileRead = {
  id: 3,
  username: 'amina',
  full_name: 'Amina Khan',
  avatar_color: '#6366f1',
  is_active: true,
  job_title: 'Engineering Manager',
  location: 'London',
  started_on: '2023-03-06',
  department: { id: 1, name: 'Engineering' },
  manager: SOFIA,
  direct_reports: [
    {
      ...SOFIA,
      id: 2,
      username: 'daniel',
      full_name: 'Daniel Okafor',
      job_title: 'Senior Backend Engineer',
    },
    {
      ...SOFIA,
      id: 4,
      username: 'kenji',
      full_name: 'Kenji Watanabe',
      job_title: 'Staff Engineer',
    },
  ],
  shared_teams: [{ id: 7, key: 'ENG', name: 'Engineering' }],
}

const WORKLOAD: WorkloadRead = {
  open_count: 12,
  points: 30,
  teams: [],
  reports: [
    { person: AMINA.direct_reports[0], open_count: 9, points: 26 },
    { person: AMINA.direct_reports[1], open_count: 2, points: 5 },
  ],
}

function renderProfile(profile: ProfileRead | null, { path }: { path?: string } = {}) {
  mocks.profile = profile
    ? { isPending: false, isError: false, data: profile }
    : { isPending: false, isError: true, data: undefined }
  mocks.workload = { isPending: false, isError: false, data: WORKLOAD }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path ?? `/people/${profile?.username ?? 'nobody'}`]}>
        <Routes>
          <Route path="/people" element={<Outlet context={{}} />}>
            <Route path=":username" element={<ProfilePage />} />
            <Route path=":username/workload" element={<ProfilePage tab="workload" />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const link = (name: string) => screen.getByRole('link', { name }).getAttribute('href')

beforeEach(() => {
  mocks.me = { id: 1 }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-28T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('A profile', () => {
  it('says who somebody is, and where they sit', () => {
    renderProfile(AMINA)
    expect(screen.getByRole('heading', { level: 1, name: /Amina Khan/ })).toBeTruthy()
    expect(screen.getByText('Engineering Manager · Engineering')).toBeTruthy()
    expect(screen.getByText('@amina')).toBeTruthy()
    expect(screen.getByText('Joined Mar 2023')).toBeTruthy()
    // How long, next to the day itself.
    expect(screen.getByText('6 Mar 2023 · 3 years')).toBeTruthy()
  })

  it('links the manager and every direct report to their own profile', () => {
    renderProfile(AMINA)
    expect(link('Sofia Marquez')).toBe('/people/sofia')
    const reports = screen.getByRole('heading', { name: 'Direct reports · 2' }).parentElement!
    expect(
      within(reports)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href'))
        .filter((href) => !href?.endsWith('/workload')),
    ).toEqual(['/people/daniel', '/people/kenji'])
  })

  it('shows the teams you share, each a way to its board', () => {
    renderProfile(AMINA)
    const teams = screen.getByRole('heading', { name: 'Teams you share' }).parentElement!
    expect(
      within(teams)
        .getByRole('link', { name: /Engineering/ })
        .getAttribute('href'),
    ).toBe('/ENG')
  })

  it('is your own with a way to Settings, and no second editor', () => {
    mocks.me = { id: 3 }
    renderProfile(AMINA)
    expect(screen.getByText('You')).toBeTruthy()
    expect(link('Edit profile')).toBe('/settings/profile')
    expect(screen.getByRole('heading', { name: 'Your teams' })).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('still resolves for a deactivated account, and says so', () => {
    renderProfile({ ...AMINA, is_active: false })
    expect(screen.getByText('Deactivated')).toBeTruthy()
    expect(screen.getByText(/Tickets and comments still point here/)).toBeTruthy()
  })

  it('shows what there is, and says when nothing is filled in', () => {
    renderProfile({
      ...AMINA,
      job_title: null,
      location: null,
      started_on: null,
      department: null,
      manager: null,
      direct_reports: [],
      shared_teams: [],
    })
    expect(screen.getByText('Nothing filled in yet.')).toBeTruthy()
    expect(screen.getByText('You share no teams.')).toBeTruthy()
    expect(screen.queryByText('Reports to')).toBeNull()
    expect(screen.queryByText(/Direct reports/)).toBeNull()
  })

  it('has a Workload tab with how much is open, at its own address (#127)', () => {
    renderProfile(AMINA)
    const tab = screen.getByRole('link', { name: 'Workload 12' })
    expect(tab.getAttribute('href')).toBe('/people/amina/workload')
    // Overview is the tab showing.
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe('page')
  })

  it('shows the workload on the Workload tab, instead of the overview', () => {
    renderProfile(AMINA, { path: '/people/amina/workload' })
    expect(screen.getByText(/in the teams you share with Amina Khan/).textContent).toBe(
      '12 open tickets in the teams you share with Amina Khan · 30 points',
    )
    expect(screen.queryByText('About')).toBeNull()
  })

  it('puts each direct report one click from their workload (#127)', () => {
    renderProfile(AMINA)
    const daniel = screen.getByRole('link', { name: 'Workload of Daniel Okafor: 9 open · 26 pts' })
    expect(daniel.getAttribute('href')).toBe('/people/daniel/workload')
    expect(daniel.textContent).toBe('9 open · 26 pts')
    expect(
      screen.getByRole('link', { name: 'Workload of Kenji Watanabe: 2 open · 5 pts' }),
    ).toBeTruthy()
  })

  it('says so when nobody goes by that name', () => {
    renderProfile(null)
    expect(screen.getByText('No one here goes by @nobody.')).toBeTruthy()
    expect(link('Go to People')).toBe('/people')
  })
})
