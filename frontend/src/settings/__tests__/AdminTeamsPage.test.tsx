// @vitest-environment jsdom
/**
 * Administration → Teams (#307): every team with its size, dates and admins,
 * the filters, and what can be done to a team from its row.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AdminTeamsPage from '@/settings/AdminTeamsPage'

const person = (id: number, full_name: string) => ({
  id,
  username: `u${id}`,
  full_name,
  avatar_color: '#3b82f6',
  is_active: true,
  job_title: null,
})

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

const team = (id: number, key: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  key,
  name,
  created_at: '2022-11-03T10:00:00Z',
  archived_at: null,
  member_count: 3,
  admins: [person(2, 'Lena Fischer')],
  ticket_count: 96,
  last_activity_at: daysAgo(0),
  quiet: false,
  can_delete: false,
  ...extra,
})

const TEAMS = [
  team(1, 'ENG', 'Engineering', {
    admins: [person(1, 'Amina Khan'), person(5, 'Demo User')],
    member_count: 8,
    ticket_count: 412,
  }),
  team(2, 'PRD', 'Product & Design'),
  team(4, 'HCK', 'Hackday 2025', {
    admins: [person(6, 'Daniel Okafor')],
    created_at: '2025-05-01T10:00:00Z',
    ticket_count: 23,
    last_activity_at: daysAgo(142),
    quiet: true,
  }),
  team(5, 'MKT', 'Marketing site', {
    admins: [],
    member_count: 0,
    ticket_count: 0,
    archived_at: daysAgo(30),
    can_delete: true,
  }),
]

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  appoint: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/api/generated/endpoints/admin/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/admin/admin')>()),
  useListTeamsAdminTeamsGet: mocks.list,
  useListTeamMembersAdminTeamsTeamIdMembersGet: () => ({
    data: [
      { user: { ...person(2, 'Lena Fischer'), email: '', is_external: false }, role: 'admin' },
      { user: { ...person(7, 'Tomas Silva'), email: '', is_external: false }, role: 'member' },
    ],
  }),
  useListUsersAdminUsersGet: () => ({
    data: {
      items: [
        { ...person(2, 'Lena Fischer'), is_external: false },
        { ...person(7, 'Tomas Silva'), is_external: false },
        { ...person(8, 'Nina Petrova'), is_external: false },
      ],
    },
  }),
  useAppointTeamAdminAdminTeamsTeamIdAdminsPost: () => ({
    mutateAsync: mocks.appoint,
    isPending: false,
  }),
  useArchiveTeamAdminTeamsTeamIdArchivePost: () => ({ mutateAsync: mocks.archive }),
  useUnarchiveTeamAdminTeamsTeamIdUnarchivePost: () => ({ mutateAsync: mocks.unarchive }),
  useDeleteTeamAdminTeamsTeamIdDelete: () => ({ mutateAsync: mocks.remove }),
}))

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AdminTeamsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const row = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

beforeEach(() => {
  mocks.list.mockReset().mockReturnValue({
    data: { items: TEAMS, total: TEAMS.length, limit: 50, offset: 0 },
    isPending: false,
  })
  for (const mock of [mocks.appoint, mocks.archive, mocks.unarchive, mocks.remove]) {
    mock.mockReset().mockResolvedValue({})
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AdminTeamsPage', () => {
  it('lists every team with its key, creation date, size, admins, tickets and last activity', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Teams' })).toBeTruthy()
    expect(
      screen.getByText(
        'Every team on this SoftTrack, as things to look after: sizes, dates and names.',
      ),
    ).toBeTruthy()
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual([
      'Team',
      'Created',
      'Members',
      'Admins',
      'Tickets',
      'Last activity',
      'Actions',
    ])
    const cells = within(row('Engineering'))
      .getAllByRole('cell')
      .map((cell) => cell.textContent)
    expect(cells.slice(0, 5)).toEqual([
      'ENGEngineering',
      'Nov 2022',
      '8',
      'Amina Khan, Demo User',
      '412',
    ])
    expect(cells[5]).toMatch(/ago$/)
  })

  it('marks one admin, quiet or archived, and an archived team with no admin', () => {
    renderPage()
    expect(within(row('Product & Design')).getByText('one admin')).toBeTruthy()
    expect(within(row('Hackday 2025')).getByText('quiet')).toBeTruthy()
    // One mark a row: quiet says more than its single admin.
    expect(within(row('Hackday 2025')).queryByText('one admin')).toBeNull()
    expect(within(row('Hackday 2025')).getByText('5 months ago')).toBeTruthy()
    const marketing = row('Marketing site')
    expect(within(marketing).getByText('archived')).toBeTruthy()
    expect(within(marketing).getByText('—')).toBeTruthy()
    expect(within(marketing).queryByText('one admin')).toBeNull()
    expect(within(row('Engineering')).queryByText('one admin')).toBeNull()
  })

  it('shows no ticket, only how many', () => {
    renderPage()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('filters on the server and shows the count on the chosen filter', async () => {
    const user = renderPage()
    const all = screen.getByRole('button', { name: /^All/ })
    expect(all.getAttribute('aria-pressed')).toBe('true')
    expect(all.textContent).toBe('All4')
    await user.click(screen.getByRole('button', { name: 'Nothing in 30 days' }))
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'quiet' }))
    await user.click(screen.getByRole('button', { name: /^One admin/ }))
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'one_admin' }))
    await user.click(screen.getByRole('button', { name: /^Archived/ }))
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'archived' }))
  })

  it('searches by name or key', async () => {
    const user = renderPage()
    await user.type(screen.getByPlaceholderText('Name or key'), 'hck')
    await vi.waitFor(() =>
      expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'hck' })),
    )
  })

  it('appoints a member as an admin, saying the change is recorded', async () => {
    const user = renderPage()
    await user.click(
      within(row('Product & Design')).getByRole('button', {
        name: 'What can be done to Product & Design',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Appoint an admin' }))
    const dialog = screen.getByRole('dialog', { name: 'Appoint an admin for Product & Design' })
    expect(within(dialog).getByText('Lena Fischer is its only admin.')).toBeTruthy()

    await user.click(within(dialog).getByRole('combobox', { name: 'Who' }))
    // The admin already is not offered.
    expect(within(dialog).queryByRole('option', { name: /Lena Fischer/ })).toBeNull()
    await user.click(within(dialog).getByRole('option', { name: /Tomas Silva/ }))
    expect(
      within(dialog).getByText(
        'Tomas is a member already. They become an admin, and the change is recorded.',
      ),
    ).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Make admin' }))
    expect(mocks.appoint).toHaveBeenCalledWith({ teamId: 2, data: { user_id: 7 } })
  })

  it('says somebody not on the team joins it as an admin', async () => {
    const user = renderPage()
    await user.click(
      within(row('Product & Design')).getByRole('button', {
        name: 'What can be done to Product & Design',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Appoint an admin' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('combobox', { name: 'Who' }))
    await user.click(within(dialog).getByRole('option', { name: /Nina Petrova/ }))
    expect(
      within(dialog).getByText(
        'Nina is not on the team. They join it as an admin, and the change is recorded.',
      ),
    ).toBeTruthy()
  })

  it('archives a team, and unarchives an archived one', async () => {
    const user = renderPage()
    await user.click(
      within(row('Hackday 2025')).getByRole('button', { name: 'What can be done to Hackday 2025' }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }))
    expect(mocks.archive).toHaveBeenCalledWith({ teamId: 4 })

    await user.click(
      within(row('Marketing site')).getByRole('button', {
        name: 'What can be done to Marketing site',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Unarchive' }))
    expect(mocks.unarchive).toHaveBeenCalledWith({ teamId: 5 })
  })

  it('deletes only a team that is empty', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = renderPage()
    await user.click(
      within(row('Hackday 2025')).getByRole('button', { name: 'What can be done to Hackday 2025' }),
    )
    const blocked = screen.getByRole('menuitem', { name: /Delete/ }) as HTMLButtonElement
    expect(blocked.disabled).toBe(true)
    expect(blocked.textContent).toContain('only when it is empty')
    await user.keyboard('{Escape}')

    await user.click(
      within(row('Marketing site')).getByRole('button', {
        name: 'What can be done to Marketing site',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(mocks.remove).toHaveBeenCalledWith({ teamId: 5 })
  })
})
