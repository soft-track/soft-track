// @vitest-environment jsdom
/**
 * Creating an account for somebody, as a site admin (#303): the dialog, the
 * link it hands back, and the row of an account nobody has signed into yet.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AdminUserCreated,
  AdminUserRead,
  ListUsersAdminUsersGetParams,
  TeamMemberRead,
} from '@/api/generated/models'
import AdminUsersPage from '@/settings/AdminUsersPage'
import { AssigneeOptions } from '@/tickets/AssigneeOptions'

const page = (items: unknown[]) => ({ items, total: items.length, limit: 25, offset: 0 })

const mocks = vi.hoisted(() => ({
  users: { isPending: false, data: undefined as unknown },
  notActivated: { isPending: false, data: undefined as unknown },
  empty: { isPending: false, data: { items: [], total: 0, limit: 8, offset: 0 } },
  create: { mutateAsync: vi.fn(), isPending: false },
  newLink: { mutateAsync: vi.fn(), isPending: false },
  noop: { mutateAsync: vi.fn(), isPending: false },
  canEmail: false,
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 1 } }),
}))

vi.mock('@/api/generated/endpoints/admin/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/admin/admin')>()),
  useListUsersAdminUsersGet: (params: ListUsersAdminUsersGetParams) => {
    if (params.role === 'not_activated' && params.limit === 1) return mocks.notActivated
    if (params.limit === 25) return mocks.users
    return mocks.empty
  },
  useListTeamsAdminTeamsGet: () => ({
    data: {
      items: [
        { id: 7, name: 'Support', key: 'SUP', archived_at: null },
        { id: 8, name: 'Old team', key: 'OLD', archived_at: '2026-01-01T00:00:00' },
      ],
      total: 2,
    },
  }),
  useCreateUserAdminUsersPost: () => mocks.create,
  useNewWelcomeLinkAdminUsersUserIdWelcomeLinkPost: () => mocks.newLink,
  useUpdateUserAdminUsersUserIdPatch: () => mocks.noop,
  useResetPasswordAdminUsersUserIdResetPasswordPost: () => mocks.noop,
}))

vi.mock('@/api/generated/endpoints/departments/departments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/departments/departments')>()),
  useListDepartmentsDepartmentsGet: () => ({
    data: [{ id: 1, name: 'Support', description: null, member_count: 0 }],
  }),
}))

vi.mock('@/api/generated/endpoints/notifications/notifications', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/api/generated/endpoints/notifications/notifications')
  >()),
  useGetNotificationSettingsNotificationsSettingsGet: () => ({
    data: { email_delivery_configured: mocks.canEmail },
  }),
}))

const YUKI: AdminUserRead = {
  id: 9,
  email: 'yuki@northwind.dev',
  username: 'yuki',
  full_name: 'Yuki Sato',
  avatar_color: '#06b6d4',
  is_active: true,
  is_activated: false,
  is_site_admin: false,
  is_finance_admin: false,
  has_password: false,
  totp_enabled: false,
  created_at: '2026-09-29T09:00:00',
  last_login_at: null,
  team_count: 1,
  report_count: 0,
  job_title: 'Support Specialist',
  location: null,
  started_on: '2026-10-05',
  department: { id: 1, name: 'Support' },
  manager: null,
  welcome_link: {
    created_at: '2026-09-29T09:00:00',
    emailed_at: '2026-09-29T09:00:00',
    expires_at: '2026-10-06T09:00:00',
  },
}

const CREATED: AdminUserCreated = {
  link: 'http://localhost:5173/welcome/abc123',
  welcome_link: {
    created_at: '2026-09-29T09:00:00',
    emailed_at: null,
    expires_at: '2026-10-06T09:00:00',
  },
  user: YUKI,
}

function renderPage(rows: AdminUserRead[]) {
  mocks.users.data = page(rows)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminUsersPage />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-30T09:00:00Z'))
  mocks.canEmail = false
  mocks.notActivated.data = page([YUKI])
  mocks.create.mutateAsync.mockReset().mockResolvedValue(CREATED)
  mocks.newLink.mutateAsync.mockReset().mockResolvedValue({
    link: 'http://localhost:5173/welcome/new456',
    welcome_link: CREATED.welcome_link,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('An account not yet activated', () => {
  it('is marked, says when it starts, and when its link was sent and runs out', () => {
    renderPage([YUKI])
    expect(screen.getByText('Not yet activated', { selector: 'span' })).toBeTruthy()
    expect(screen.getByText('Support Specialist · Support · starts 5 Oct 2026')).toBeTruthy()
    expect(
      screen.getByText(/yuki@northwind\.dev · 1 team · link sent 29 Sep, expires in 6 days/),
    ).toBeTruthy()
  })

  it('counts them beside their filter', () => {
    renderPage([YUKI])
    const filter = screen.getByRole('button', { name: /Not yet activated/ })
    expect(filter.textContent).toBe('Not yet activated1')
  })

  it('offers Edit and Copy link, and not a password or a role', () => {
    renderPage([YUKI])
    expect(screen.getByRole('button', { name: 'Edit Yuki Sato' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reset password' })).toBeNull()
    expect(screen.queryByRole('button', { name: /site admin/ })).toBeNull()
    // No mail server, so nothing to send it again with.
    expect(screen.queryByRole('button', { name: 'Send the link again' })).toBeNull()
  })

  it('copies a new link', async () => {
    const user = renderPage([YUKI])
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await user.click(screen.getByRole('button', { name: 'Copy link' }))

    expect(mocks.newLink.mutateAsync).toHaveBeenCalledWith({
      userId: 9,
      data: { send_email: false },
    })
    expect(writeText).toHaveBeenCalledWith('http://localhost:5173/welcome/new456')
    expect(screen.getByRole('status').textContent).toBe(
      'A new link for Yuki Sato is on your clipboard.',
    )
  })

  it('sends the link again where the instance can send mail', async () => {
    mocks.canEmail = true
    const user = renderPage([YUKI])
    await user.click(screen.getByRole('button', { name: 'Send the link again' }))
    expect(mocks.newLink.mutateAsync).toHaveBeenCalledWith({
      userId: 9,
      data: { send_email: true },
    })
    expect(screen.getByRole('status').textContent).toBe(
      'A new link was sent to yuki@northwind.dev.',
    )
  })
})

describe('New account', () => {
  it('creates one with a team and a role, and hands back the link to copy', async () => {
    const user = renderPage([])
    await user.click(screen.getByRole('button', { name: 'New account' }))
    const dialog = screen.getByRole('dialog', { name: 'New account' })

    await user.type(within(dialog).getByLabelText('Full name'), 'Yuki Sato')
    await user.type(within(dialog).getByLabelText('Username'), 'yuki')
    await user.type(within(dialog).getByLabelText('Email'), 'yuki@northwind.dev')
    await user.selectOptions(within(dialog).getByLabelText('Department'), 'Support')
    // An archived team takes nobody new.
    expect(within(dialog).queryByRole('option', { name: 'Old team' })).toBeNull()
    await user.selectOptions(within(dialog).getByLabelText('Team'), 'Support')
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'Admin')
    await user.click(within(dialog).getByRole('button', { name: 'Create and get the link' }))

    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      data: {
        full_name: 'Yuki Sato',
        email: 'yuki@northwind.dev',
        username: 'yuki',
        job_title: null,
        started_on: null,
        department_id: 1,
        manager_id: null,
        teams: [{ team_id: 7, role: 'admin' }],
        send_email: false,
      },
    })
    const done = screen.getByRole('dialog', { name: 'Yuki Sato’s account is ready' })
    expect(within(done).getByText('Without SMTP')).toBeTruthy()
    expect(within(done).getByText('http://localhost:5173/welcome/abc123')).toBeTruthy()
    expect(within(done).getByRole('button', { name: 'Copy the link' })).toBeTruthy()
  })

  it('sends the link where the instance can send mail', async () => {
    mocks.canEmail = true
    mocks.create.mutateAsync.mockResolvedValue({
      ...CREATED,
      welcome_link: { ...CREATED.welcome_link, emailed_at: '2026-09-29T09:00:00' },
    })
    const user = renderPage([])
    await user.click(screen.getByRole('button', { name: 'New account' }))
    const dialog = screen.getByRole('dialog', { name: 'New account' })
    await user.type(within(dialog).getByLabelText('Full name'), 'Yuki Sato')
    await user.type(within(dialog).getByLabelText('Email'), 'yuki@northwind.dev')
    await user.click(within(dialog).getByRole('button', { name: 'Create and send the link' }))

    expect(mocks.create.mutateAsync.mock.calls[0][0].data).toMatchObject({
      username: null,
      teams: [],
      send_email: true,
    })
    expect(
      screen.getByText(
        'A link to choose a password was sent to yuki@northwind.dev. It works once, until 6 October.',
      ),
    ).toBeTruthy()
  })
})

describe('Assignee pickers', () => {
  it('mark an account not yet activated, and still offer it', () => {
    const members = [
      { user: { ...YUKI }, role: 'member', joined_at: '2026-09-29T09:00:00' },
      {
        user: { ...YUKI, id: 3, full_name: 'Nina Petrova', is_activated: true },
        role: 'member',
        joined_at: '2026-09-29T09:00:00',
      },
    ] as TeamMemberRead[]
    render(
      <select aria-label="Assignee">
        <AssigneeOptions members={members} />
      </select>,
    )
    const yuki = screen.getByRole('option', { name: 'Yuki Sato · not yet activated' })
    expect((yuki as HTMLOptionElement).disabled).toBe(false)
    expect(screen.getByRole('option', { name: 'Nina Petrova' })).toBeTruthy()
  })
})
