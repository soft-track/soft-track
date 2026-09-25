import { describe, expect, it } from 'vitest'

import { ERROR_MESSAGES, errorCode, errorDetail } from '@/api/errors'

const failed = (data: unknown) => ({ response: { data } })

describe('errorDetail', () => {
  it('prefers the frontend message for a code it knows', () => {
    const err = failed({ detail: 'Only team admins can do that', code: 'not_team_admin' })
    expect(errorDetail(err, 'fallback')).toBe(ERROR_MESSAGES.not_team_admin)
  })

  it("falls back to the server's sentence for a code it does not know", () => {
    const err = failed({ detail: 'That cycle is already completed.', code: 'cycle_completed' })
    expect(errorDetail(err, 'fallback')).toBe('That cycle is already completed.')
  })

  it('keeps the wait in a rate-limit message, which only the server knows', () => {
    const err = failed({ detail: 'Too many attempts. Try again in 8 seconds.', code: 'rate_limited' })
    expect(errorDetail(err, 'fallback')).toMatch(/8 seconds/)
  })

  it('still reads an error from before codes existed', () => {
    expect(errorDetail(failed({ detail: 'Something specific' }), 'fallback')).toBe(
      'Something specific',
    )
  })

  it('uses the fallback for a network failure or a list of field errors', () => {
    expect(errorDetail(new Error('Network Error'), 'fallback')).toBe('fallback')
    expect(errorDetail(failed({ detail: [{ loc: ['body'], msg: 'x' }] }), 'fallback')).toBe(
      'fallback',
    )
  })
})

describe('errorCode', () => {
  it('reads the code, and only a string one', () => {
    expect(errorCode(failed({ code: 'issue_not_found' }))).toBe('issue_not_found')
    expect(errorCode(failed({ code: 42 }))).toBeNull()
    expect(errorCode(undefined)).toBeNull()
  })
})
