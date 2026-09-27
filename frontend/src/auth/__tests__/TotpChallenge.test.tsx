// @vitest-environment jsdom
/**
 * The second step of signing in, shared by the password form and the
 * Google/GitHub callback. What matters: the code goes to `totpVerify` with the
 * pending token, a wrong code stays on this step, and an expired sign-in goes
 * back to the first one -- where no code could have worked.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TotpChallenge } from '@/auth/TotpChallenge'
import { isTotpPending } from '@/auth/useAuth'

const mocks = vi.hoisted(() => ({ totpVerify: vi.fn() }))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ totpVerify: mocks.totpVerify }),
}))

function renderChallenge() {
  const onSignedIn = vi.fn()
  const onRestart = vi.fn()
  render(<TotpChallenge pendingToken="pending-1" onSignedIn={onSignedIn} onRestart={onRestart} />)
  return { user: userEvent.setup(), onSignedIn, onRestart }
}

beforeEach(() => {
  mocks.totpVerify.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('TotpChallenge', () => {
  it('sends the code with the pending token, and signs in', async () => {
    const { user, onSignedIn } = renderChallenge()

    await user.type(screen.getByLabelText('Authentication code'), ' 123456 ')
    await user.click(screen.getByRole('button', { name: 'Verify' }))

    expect(mocks.totpVerify).toHaveBeenCalledWith('pending-1', '123456')
    expect(onSignedIn).toHaveBeenCalled()
  })

  it('stays on this step for a wrong code, in the interface’s own words', async () => {
    mocks.totpVerify.mockRejectedValue({
      response: { data: { detail: 'Invalid or expired two-factor code', code: 'totp_code_invalid' } },
    })
    const { user, onSignedIn, onRestart } = renderChallenge()

    await user.type(screen.getByLabelText('Authentication code'), '000000')
    await user.click(screen.getByRole('button', { name: 'Verify' }))

    expect(screen.getByRole('alert').textContent).toContain('each one works once')
    expect(onSignedIn).not.toHaveBeenCalled()
    expect(onRestart).not.toHaveBeenCalled()
  })

  it('goes back to the first step when the sign-in has expired', async () => {
    mocks.totpVerify.mockRejectedValue({
      response: { data: { detail: 'expired', code: 'totp_session_expired' } },
    })
    const { user, onRestart } = renderChallenge()

    await user.type(screen.getByLabelText('Authentication code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify' }))

    expect(onRestart).toHaveBeenCalledWith('That sign-in took too long. Start again.')
  })

  it('can be abandoned', async () => {
    const { user, onRestart } = renderChallenge()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    expect(onRestart).toHaveBeenCalledWith()
  })
})

describe('isTotpPending', () => {
  it('tells a pending sign-in from a session', () => {
    expect(isTotpPending({ pending_token: 'p', totp_required: true })).toBe(true)
    expect(
      isTotpPending({
        access_token: 'a',
        token_type: 'bearer',
        user: {} as never,
      }),
    ).toBe(false)
  })
})
