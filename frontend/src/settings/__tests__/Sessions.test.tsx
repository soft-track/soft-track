// @vitest-environment jsdom
/**
 * Where your account is signed in (#308): this device marked, Revoke on the
 * others, and API tokens nowhere in the list.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Sessions } from '@/settings/Sessions'

const mocks = vi.hoisted(() => ({
  list: { data: [] as unknown[], isError: false },
  revoke: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/auth/auth')>()),
  useListMySessionsAuthMeSessionsGet: () => mocks.list,
  useRevokeMySessionAuthMeSessionsSessionIdDelete: () => mocks.revoke,
}))

const LAPTOP = {
  id: 1,
  browser: 'Firefox',
  system: 'Linux',
  ip_address: '203.0.113.7',
  created_at: '2026-09-28T09:00:00',
  last_used_at: '2026-10-12T09:00:00',
  current: true,
}
const PHONE = {
  id: 2,
  browser: 'Safari',
  system: 'iPhone',
  ip_address: '198.51.100.64',
  created_at: '2026-09-21T09:00:00',
  last_used_at: '2026-10-12T07:00:00',
  current: false,
}
const UNKNOWN = { ...PHONE, id: 3, browser: null, system: null }

function renderSessions() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Sessions />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.list.data = [LAPTOP, PHONE]
  mocks.list.isError = false
  mocks.revoke.mutateAsync.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Sessions', () => {
  it('lists each browser with its address and dates, this device marked', () => {
    renderSessions()
    const [laptop, phone] = screen.getAllByRole('listitem')
    expect(laptop.textContent).toContain('Firefox on Linux')
    expect(laptop.textContent).toContain('this device')
    expect(laptop.textContent).toContain('203.0.113.7 · began 28 Sep · last used now')
    expect(within(laptop).queryByRole('button')).toBeNull()

    expect(phone.textContent).toContain('Safari on iPhone')
    expect(phone.textContent).not.toContain('this device')
    expect(phone.textContent).toContain('198.51.100.64 · began 21 Sep · last used')
    expect(within(phone).getByRole('button', { name: 'Revoke Safari on iPhone' })).toBeTruthy()
  })

  it('revokes one session and leaves the rest', async () => {
    const user = renderSessions()
    await user.click(screen.getByRole('button', { name: 'Revoke Safari on iPhone' }))
    expect(mocks.revoke.mutateAsync).toHaveBeenCalledWith({ sessionId: 2 })
    expect(mocks.revoke.mutateAsync).toHaveBeenCalledTimes(1)
  })

  it('says why a revoke failed', async () => {
    mocks.revoke.mutateAsync.mockRejectedValue(new Error('nope'))
    const user = renderSessions()
    await user.click(screen.getByRole('button', { name: 'Revoke Safari on iPhone' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Could not revoke that session.'),
    )
  })

  it('names a browser it cannot read plainly', () => {
    mocks.list.data = [LAPTOP, UNKNOWN]
    renderSessions()
    expect(screen.getAllByRole('listitem')[1].textContent).toContain('An unknown browser')
  })

  it('says API tokens are not sessions', () => {
    renderSessions()
    expect(screen.getByText(/API tokens are not sessions/)).toBeTruthy()
  })
})
