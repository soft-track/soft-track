// @vitest-environment jsdom
/**
 * Administration → Users (#122): what people say about themselves, shown on
 * their row, and the start date a site admin sets inline.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminUserRead } from '@/api/generated/models'
import AdminUsersPage from '@/settings/AdminUsersPage'

const mocks = vi.hoisted(() => ({
  users: { isPending: false, data: { items: [] as unknown[], total: 0, limit: 25, offset: 0 } },
  update: { mutateAsync: vi.fn(), isPending: false },
  reset: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: { id: 1 } }),
}))

vi.mock('@/api/generated/endpoints/admin/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/admin/admin')>()),
  useListUsersAdminUsersGet: () => mocks.users,
  useUpdateUserAdminUsersUserIdPatch: () => mocks.update,
  useResetPasswordAdminUsersUserIdResetPasswordPost: () => mocks.reset,
}))

const DANIEL: AdminUserRead = {
  id: 2,
  email: 'daniel@northwind.dev',
  username: 'daniel',
  full_name: 'Daniel Okafor',
  avatar_color: '#14b8a6',
  is_active: true,
  is_site_admin: false,
  has_password: true,
  created_at: '2026-01-01T00:00:00',
  last_login_at: null,
  team_count: 1,
  job_title: 'Senior Backend Engineer',
  location: 'Lagos, Nigeria',
  started_on: '2023-08-14',
}

function renderPage(rows: AdminUserRead[]) {
  mocks.users.data = { items: rows, total: rows.length, limit: 25, offset: 0 }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminUsersPage />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.update.mutateAsync.mockReset().mockResolvedValue(DANIEL)
})

afterEach(() => {
  cleanup()
})

describe('The admin user directory', () => {
  it('shows title, location and start date on the row', () => {
    renderPage([DANIEL])
    expect(
      screen.getByText('Senior Backend Engineer · Lagos, Nigeria · started 14 Aug 2023'),
    ).toBeTruthy()
  })

  it('shows no line at all for someone with nothing filled in', () => {
    renderPage([{ ...DANIEL, job_title: null, location: null, started_on: null }])
    expect(screen.queryByText(/started/)).toBeNull()
    expect(screen.queryByText(/Lagos/)).toBeNull()
  })

  it('sets a start date inline, and not the title or location', async () => {
    const user = renderPage([{ ...DANIEL, started_on: null }])

    await user.click(screen.getByRole('button', { name: 'Edit Daniel Okafor' }))
    const editor = screen.getByRole('form', { name: 'Organisation details for Daniel Okafor' })
    expect(within(editor).queryByLabelText(/Job title/)).toBeNull()

    await user.type(within(editor).getByLabelText('Start date'), '2023-08-14')
    await user.click(within(editor).getByRole('button', { name: 'Save' }))

    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      userId: 2,
      data: { started_on: '2023-08-14' },
    })
    // Closed once it has saved.
    expect(screen.queryByRole('form', { name: /Organisation details/ })).toBeNull()
  })

  it('clears a start date with an explicit null', async () => {
    const user = renderPage([DANIEL])

    await user.click(screen.getByRole('button', { name: 'Edit Daniel Okafor' }))
    const editor = screen.getByRole('form', { name: /Organisation details/ })
    await user.clear(within(editor).getByLabelText('Start date'))
    await user.click(within(editor).getByRole('button', { name: 'Save' }))

    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      userId: 2,
      data: { started_on: null },
    })
  })

  it('keeps the editor open when the save fails', async () => {
    mocks.update.mutateAsync.mockRejectedValue({
      response: { data: { detail: 'Nope', code: 'user_not_found' } },
    })
    const user = renderPage([DANIEL])

    await user.click(screen.getByRole('button', { name: 'Edit Daniel Okafor' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert').textContent).toBe('Nope')
    expect(screen.getByRole('form', { name: /Organisation details/ })).toBeTruthy()
  })
})
