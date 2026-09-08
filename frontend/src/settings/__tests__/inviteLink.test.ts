import { describe, expect, it } from 'vitest'

import { inviteUrl } from '@/settings/inviteLink'

describe('inviteUrl', () => {
  it('builds an absolute link on the given origin', () => {
    expect(inviteUrl('abc123', 'https://track.example')).toBe(
      'https://track.example/invite/abc123',
    )
  })

  it('keeps the token verbatim', () => {
    // token_urlsafe output contains - and _, which must survive untouched.
    expect(inviteUrl('a-b_c', 'https://track.example')).toBe(
      'https://track.example/invite/a-b_c',
    )
  })

  it('works against a host with a port, as a self-hosted instance usually is', () => {
    expect(inviteUrl('t', 'http://localhost:5173')).toBe('http://localhost:5173/invite/t')
  })
})
