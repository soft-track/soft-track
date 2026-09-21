/**
 * What `/` shows, which is the whole of issue #65 in one function.
 *
 * Before the landing page, `/` sat inside RequireAuth and a signed-out
 * visitor was bounced to /login unconditionally. These four states are what
 * replaced that.
 */
import { describe, expect, it } from 'vitest'

import { homeView } from '@/landing/homeView'

const RESOLVED = { isLoading: false, configPending: false }

describe('homeView', () => {
  it('is the landing page for a signed-out visitor', () => {
    expect(
      homeView({ ...RESOLVED, isAuthenticated: false, landingPage: true }),
    ).toBe('landing')
  })

  it('is the sign-in form when the instance turned the landing page off', () => {
    expect(
      homeView({ ...RESOLVED, isAuthenticated: false, landingPage: false }),
    ).toBe('login')
  })

  it('is TeamsHome for a signed-in user, landing page on or off', () => {
    for (const landingPage of [true, false, undefined]) {
      expect(homeView({ ...RESOLVED, isAuthenticated: true, landingPage })).toBe('teams')
    }
  })

  it('waits rather than guessing while the session is resolving', () => {
    expect(
      homeView({
        isLoading: true,
        configPending: false,
        isAuthenticated: false,
        landingPage: true,
      }),
    ).toBe('loading')
  })

  it('waits for the switch too, so a disabled landing page never flashes', () => {
    expect(
      homeView({
        isLoading: false,
        configPending: true,
        isAuthenticated: false,
        landingPage: undefined,
      }),
    ).toBe('loading')
  })

  it('falls back to the landing page when /auth/config never answered', () => {
    expect(
      homeView({ ...RESOLVED, isAuthenticated: false, landingPage: undefined }),
    ).toBe('landing')
  })
})
