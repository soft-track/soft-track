// @vitest-environment jsdom
/**
 * Settings → Profile (#122): the title and location you edit yourself, and
 * the facts a site admin sets, read-only beneath them.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UserMe } from '@/api/generated/models'
import ProfileSettings from '@/settings/ProfileSettings'

const mocks = vi.hoisted(() => ({
  user: null as unknown,
  update: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: mocks.user }),
}))

vi.mock('@/api/generated/endpoints/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/auth/auth')>()),
  useUpdateMeAuthMePatch: () => mocks.update,
}))

const DANIEL: UserMe = {
  id: 2,
  email: 'daniel@northwind.dev',
  username: 'daniel',
  full_name: 'Daniel Okafor',
  avatar_color: '#14b8a6',
  is_active: true,
  is_site_admin: false,
  is_finance_admin: false,
  has_password: true,
  created_at: '2026-01-01T00:00:00',
  job_title: null,
  location: null,
  started_on: null,
}

function renderProfile(user: UserMe) {
  mocks.user = user
  render(
    // A router, since the manager's name is a link to their profile (#126).
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <ProfileSettings />
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.update.mutateAsync.mockReset().mockImplementation(({ data }) => ({
    ...DANIEL,
    ...data,
  }))
})

afterEach(() => {
  cleanup()
})

describe('Profile settings', () => {
  it('saves a title and a location with the rest of the form', async () => {
    const user = renderProfile(DANIEL)

    await user.type(screen.getByLabelText(/Job title/), 'Senior Backend Engineer')
    await user.type(screen.getByLabelText(/Location/), 'Lagos, Nigeria')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      data: expect.objectContaining({
        job_title: 'Senior Backend Engineer',
        location: 'Lagos, Nigeria',
      }),
    })
  })

  it('shows what was stored once it has saved', async () => {
    mocks.update.mutateAsync.mockResolvedValue({ ...DANIEL, job_title: 'Designer' })
    const user = renderProfile(DANIEL)

    await user.type(screen.getByLabelText(/Job title/), '  Designer  ')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect((screen.getByLabelText(/Job title/) as HTMLInputElement).value).toBe('Designer')
  })

  it('sends an emptied field, which is how a title is cleared', async () => {
    const user = renderProfile({ ...DANIEL, job_title: 'Designer' })

    await user.clear(screen.getByLabelText(/Job title/))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      data: expect.objectContaining({ job_title: '' }),
    })
  })

  it('shows the department and start date read-only, and says who sets them', () => {
    renderProfile({
      ...DANIEL,
      started_on: '2023-08-14',
      department: { id: 1, name: 'Engineering' },
    })

    const card = screen.getByRole('region', { name: 'Your place in the organisation' })
    expect(within(card).getByText('Set by a site admin. Ask one if something here is wrong.'))
      .toBeTruthy()
    expect(within(card).getByText('Engineering')).toBeTruthy()
    expect(within(card).getByText('14 Aug 2023')).toBeTruthy()
    // Nothing in it to edit.
    expect(within(card).queryByRole('textbox')).toBeNull()
  })

  it('says a fact is not set rather than leaving a gap', () => {
    renderProfile(DANIEL)
    const card = screen.getByRole('region', { name: 'Your place in the organisation' })
    expect(within(card).getAllByText('Not set')).toHaveLength(3)
  })

  it('shows who you report to, and says so when their account is deactivated', () => {
    renderProfile({
      ...DANIEL,
      manager: {
        id: 3,
        username: 'amina',
        full_name: 'Amina Khan',
        avatar_color: '#6366f1',
        is_active: false,
        job_title: 'Engineering Manager',
      },
    })
    const card = screen.getByRole('region', { name: 'Your place in the organisation' })
    const manager = within(card).getByText('Manager').parentElement!
    expect(within(manager).getByRole('link', { name: 'Amina Khan' }).getAttribute('href')).toBe(
      '/people/amina',
    )
    expect(within(manager).getByText('Deactivated')).toBeTruthy()
  })
})
