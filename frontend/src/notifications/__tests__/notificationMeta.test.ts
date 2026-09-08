import { describe as group, expect, it } from 'vitest'

import type { NotificationRead } from '@/api/generated/models'
import { badgeLabel, describe, issueHref } from '@/notifications/notificationMeta'

const base: NotificationRead = {
  id: 1,
  kind: 'commented',
  issue: {
    id: 7,
    team_id: 1,
    team_key: 'ENG',
    number: 42,
    identifier: 'ENG-42',
    title: 'The bug',
  },
  actor: {
    id: 2,
    email: 'sam@example.com',
    username: 'sam',
    full_name: 'Sam Rivera',
    avatar_color: '#6366f1',
    is_active: true,
  },
  excerpt: 'Reproduced on staging',
  read: false,
  created_at: '2026-09-08T09:00:00',
}

group('describe', () => {
  it('names the person and what they did', () => {
    expect(describe(base)).toBe('Sam Rivera commented')
    expect(describe({ ...base, kind: 'assigned' })).toBe('Sam Rivera assigned this to you')
    expect(describe({ ...base, kind: 'mentioned' })).toBe('Sam Rivera mentioned you')
  })

  it('reads as a sentence when nobody did it', () => {
    // An import has no actor; "Someone changed the status" would be a claim
    // about a person who does not exist.
    expect(describe({ ...base, kind: 'status_changed', actor: null })).toBe(
      'Changed the status',
    )
  })
})

group('issueHref', () => {
  it('points at the board route for the issue', () => {
    expect(issueHref(base)).toBe('/ENG/issue/42')
  })
})

group('badgeLabel', () => {
  it('stops counting past nine', () => {
    expect(badgeLabel(0)).toBe('0')
    expect(badgeLabel(9)).toBe('9')
    expect(badgeLabel(10)).toBe('9+')
  })
})
