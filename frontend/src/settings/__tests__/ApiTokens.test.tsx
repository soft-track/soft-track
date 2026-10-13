// @vitest-environment jsdom
/**
 * Personal API tokens in settings (issue #90): made with a name and an
 * expiry, the secret shown once, revoked from the list.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiTokens } from '@/settings/ApiTokens'

const mocks = vi.hoisted(() => ({
  list: { data: [] as unknown[] },
  create: { mutateAsync: vi.fn(), isPending: false },
  revoke: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/auth/auth')>()),
  useListApiTokensAuthMeTokensGet: () => mocks.list,
  useCreateApiTokenAuthMeTokensPost: () => mocks.create,
  useRevokeApiTokenAuthMeTokensTokenIdDelete: () => mocks.revoke,
}))

const TOKEN = {
  id: 3,
  name: 'Nightly export',
  hint: 'softtrack_…Xy3Q',
  created_at: '2026-09-20T09:00:00',
  last_used_at: null,
  expires_at: null,
}

function renderTokens() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiTokens />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.list.data = []
  mocks.create.mutateAsync.mockReset()
  mocks.revoke.mutateAsync.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('API tokens', () => {
  it('creates a token with a name and an expiry, and shows its secret once', async () => {
    mocks.create.mutateAsync.mockResolvedValue({ ...TOKEN, token: 'softtrack_secretXy3Q' })
    const user = renderTokens()

    await user.type(screen.getByPlaceholderText('Nightly export'), 'Nightly export')
    await user.selectOptions(screen.getByLabelText('Expires'), '30')
    await user.click(screen.getByRole('button', { name: 'Create token' }))

    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      data: { name: 'Nightly export', expires_in_days: 30 },
    })
    await waitFor(() =>
      expect(screen.getByTestId('new-token').textContent).toBe('softtrack_secretXy3Q'),
    )
    expect(screen.getByRole('status').textContent).toMatch(/will not be shown again/)
  })

  it('sends no expiry for a token that never expires', async () => {
    mocks.create.mutateAsync.mockResolvedValue({ ...TOKEN, token: 'softtrack_x' })
    const user = renderTokens()
    await user.type(screen.getByPlaceholderText('Nightly export'), 'CI')
    await user.selectOptions(screen.getByLabelText('Expires'), '0')
    await user.click(screen.getByRole('button', { name: 'Create token' }))
    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      data: { name: 'CI', expires_in_days: null },
    })
  })

  it('lists tokens by hint and says when each was last used', () => {
    mocks.list.data = [TOKEN]
    renderTokens()
    expect(screen.getByText('softtrack_…Xy3Q')).toBeTruthy()
    expect(screen.getByText(/never used/)).toBeTruthy()
    expect(screen.getByText(/does not expire/)).toBeTruthy()
  })

  it('revokes a token after asking', async () => {
    mocks.list.data = [TOKEN]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = renderTokens()
    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(mocks.revoke.mutateAsync).toHaveBeenCalledWith({ tokenId: 3 })
  })
})
