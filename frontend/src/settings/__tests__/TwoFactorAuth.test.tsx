// @vitest-environment jsdom
/**
 * Where the two-factor dialogs render. The card is `glass-strong`, whose
 * `backdrop-filter` makes it the containing block for anything `fixed` inside
 * it: a dialog drawn in the card was trapped there, and the cards below it
 * painted over the recovery codes. So every dialog goes to `document.body`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TwoFactorAuth } from '@/settings/TwoFactorAuth'

const mocks = vi.hoisted(() => ({
  enrol: vi.fn(),
  user: { totp_enabled: false } as { totp_enabled: boolean },
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: mocks.user, setSession: vi.fn() }),
}))

vi.mock('@/api/generated/endpoints/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/auth/auth')>()),
  useTotpEnrolAuthTotpEnrolPost: () => ({ mutateAsync: mocks.enrol, isPending: false }),
  useTotpConfirmAuthTotpConfirmPost: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTotpDisableAuthTotpDisablePost: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function renderCard() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TwoFactorAuth />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.user = { totp_enabled: false }
  mocks.enrol.mockReset().mockResolvedValue({
    provisioning_uri: 'otpauth://totp/SoftTrack:demo?secret=JBSWY3DPEHPK3PXP',
    manual_key: 'JBSWY3DPEHPK3PXP',
  })
})

afterEach(() => {
  cleanup()
})

describe('TwoFactorAuth', () => {
  it('draws the setup dialog outside the card', async () => {
    const user = renderCard()

    await user.click(screen.getByRole('button', { name: /set up/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog.closest('section')).toBeNull()
  })

  it('draws the turn-off dialog outside the card', async () => {
    mocks.user = { totp_enabled: true }
    const user = renderCard()

    await user.click(screen.getByRole('button', { name: /turn off/i }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog.closest('section')).toBeNull()
  })
})
