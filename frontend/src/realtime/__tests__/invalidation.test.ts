import type { Query } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { invalidationFor } from '@/realtime/invalidation'

const query = (...key: unknown[]) => ({ queryKey: key }) as unknown as Query

function hits(event: string, data: string, keys: string[]) {
  const which = invalidationFor(7, { event, data })
  if (which === 'all' || which === null) throw new Error(String(which))
  return keys.filter((key) => which(query(key, {})))
}

const KEYS = [
  '/teams/7/issues',
  '/teams/7/estimates',
  '/teams/7/cycles',
  '/teams/8/issues',
  '/issues/42',
  '/issues/42/comments',
  '/issues/42/events',
  '/issues/420',
  '/issues/4',
  '/notifications',
  '/notifications/unread-count',
  '/search',
]

describe('invalidationFor (#103)', () => {
  it('refreshes the board and the one issue, not its neighbours by prefix', () => {
    expect(hits('issue_changed', '{"id": 42}', KEYS)).toEqual([
      '/teams/7/issues',
      '/teams/7/estimates',
      '/teams/7/cycles',
      '/issues/42',
      '/issues/42/comments',
      '/issues/42/events',
    ])
  })

  it('refreshes only the thread for a comment', () => {
    expect(hits('comment_added', '{"issue_id": 42}', KEYS)).toEqual([
      '/issues/42/comments',
      '/issues/42/events',
    ])
  })

  it('refreshes the inbox for a notification', () => {
    expect(hits('notification', '{}', KEYS)).toEqual(['/notifications', '/notifications/unread-count'])
  })

  it('refreshes everything on a resync, and nothing for an unknown event', () => {
    expect(invalidationFor(7, { event: 'resync', data: '{}' })).toBe('all')
    expect(invalidationFor(7, { event: 'something_new', data: '{}' })).toBeNull()
  })
})
