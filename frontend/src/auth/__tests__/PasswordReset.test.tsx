// @vitest-environment jsdom
/**
 * The two signed-out pages of the password reset flow (issue #83).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ForgotPasswordPage from '@/auth/ForgotPasswordPage'
import ResetPasswordPage from '@/auth/ResetPasswordPage'

const mocks = vi.hoisted(() => ({
  forgot: { mutateAsync: vi.fn(), isPending: false },
  reset: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/auth/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/auth/auth')>()),
  useForgotPasswordAuthForgotPasswordPost: () => mocks.forgot,
  useResetPasswordAuthResetPasswordPost: () => mocks.reset,
}))

/** Shows where the router is, so a test can see the token leave the URL. */
function Location() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname + location.search}</span>
}

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/login" element={<p>Sign-in page</p>} />
        </Routes>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.forgot.mutateAsync.mockReset().mockResolvedValue(undefined)
  mocks.reset.mutateAsync.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('asking for a link', () => {
  it('sends the address, then says the same thing whether or not it has an account', async () => {
    const user = renderAt('/forgot-password')
    await user.type(screen.getByLabelText('Email'), 'sam@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(mocks.forgot.mutateAsync).toHaveBeenCalledWith({ data: { email: 'sam@example.com' } })
    expect(screen.getByRole('status').textContent).toMatch(
      /If sam@example.com has an account here, a reset link is on its way/,
    )
  })

  it('shows the throttle message when asked too often', async () => {
    mocks.forgot.mutateAsync.mockRejectedValue({
      response: { data: { detail: 'Too many password reset requests. Try again in 60 seconds.' } },
    })
    const user = renderAt('/forgot-password')
    await user.type(screen.getByLabelText('Email'), 'sam@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(screen.getByRole('alert').textContent).toMatch(/Try again in 60 seconds/)
  })
})

describe('using the link', () => {
  it('takes the token out of the address bar as soon as it has read it', () => {
    renderAt('/reset-password?token=secret-token')
    expect(screen.getByTestId('location').textContent).toBe('/reset-password')
  })

  it('sends the token with the new password, then points at sign-in', async () => {
    const user = renderAt('/reset-password?token=secret-token')
    await user.type(screen.getByLabelText('New password'), 'brand-new-password')
    await user.type(screen.getByLabelText('Confirm new password'), 'brand-new-password')
    await user.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(mocks.reset.mutateAsync).toHaveBeenCalledWith({
      data: { token: 'secret-token', new_password: 'brand-new-password' },
    })
    expect(screen.getByRole('status').textContent).toMatch(/signed out everywhere/)
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login')
  })

  it('catches a mistyped confirmation before sending anything', async () => {
    const user = renderAt('/reset-password?token=secret-token')
    await user.type(screen.getByLabelText('New password'), 'brand-new-password')
    await user.type(screen.getByLabelText('Confirm new password'), 'brand-new-passwerd')
    await user.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(mocks.reset.mutateAsync).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/do not match/)
  })

  it('offers a new link when this one is spent', async () => {
    mocks.reset.mutateAsync.mockRejectedValue({
      response: { data: { detail: 'This reset link is invalid or has expired. Ask for a new one.' } },
    })
    const user = renderAt('/reset-password?token=old-token')
    await user.type(screen.getByLabelText('New password'), 'brand-new-password')
    await user.type(screen.getByLabelText('Confirm new password'), 'brand-new-password')
    await user.click(screen.getByRole('button', { name: 'Set new password' }))

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/invalid or has expired/)
    expect(screen.getByRole('link', { name: 'Ask for a new link' })).toBeTruthy()
  })

  it('explains itself when opened without a token', () => {
    renderAt('/reset-password')
    expect(screen.getByRole('alert').textContent).toMatch(/needs the link from your reset email/)
  })
})
