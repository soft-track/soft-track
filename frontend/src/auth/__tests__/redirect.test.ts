/**
 * Where signing in lands, which is the half of the landing page change that
 * is easy to break silently.
 *
 * `/` moved out of RequireAuth, so a signed-out visitor now has somewhere to
 * be sent that is not the sign-in form. Deep links have to survive that: the
 * person who opened /ENG/issue/42 wants the issue afterwards, not the front
 * page.
 */
import { describe, expect, it } from 'vitest'

import { SIGN_IN_FALLBACK, signInDestination } from '@/auth/redirect'

describe('signInDestination', () => {
  it('returns to the deep link RequireAuth was holding', () => {
    expect(signInDestination(null, { pathname: '/ENG/issue/42' })).toBe('/ENG/issue/42')
  })

  it('returns to ?next=, for a link pasted into a fresh tab with no state', () => {
    expect(signInDestination('/ENG/issue/42', undefined)).toBe('/ENG/issue/42')
  })

  it('prefers ?next= over the state, since it is the more explicit of the two', () => {
    expect(signInDestination('/ENG/issue/42', { pathname: '/OTHER' })).toBe('/ENG/issue/42')
  })

  it('falls back to the front page when neither says anything', () => {
    expect(signInDestination(null, undefined)).toBe(SIGN_IN_FALLBACK)
    expect(signInDestination('', null)).toBe(SIGN_IN_FALLBACK)
    expect(signInDestination(undefined, { pathname: '' })).toBe(SIGN_IN_FALLBACK)
  })

  it.each([
    'https://elsewhere.example/phish',
    '//elsewhere.example/phish',
    '/\\elsewhere.example/phish',
    'javascript:alert(1)',
    'ENG/issue/42',
  ])('refuses to send anyone to %s', (next) => {
    expect(signInDestination(next, undefined)).toBe(SIGN_IN_FALLBACK)
  })

  it('keeps a query string on a same-site path', () => {
    expect(signInDestination('/ENG?status=in_progress', undefined)).toBe(
      '/ENG?status=in_progress',
    )
  })
})
