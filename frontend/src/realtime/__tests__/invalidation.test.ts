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
  '/teams/7/tickets',
  '/teams/7/estimates',
  '/teams/7/sprints',
  '/teams/8/tickets',
  '/tickets/42',
  '/tickets/42/comments',
  '/tickets/42/events',
  '/tickets/420',
  '/tickets/4',
  '/notifications',
  '/notifications/unread-count',
  '/search',
]

describe('invalidationFor (#103)', () => {
  it('refreshes the board and the one ticket, not its neighbours by prefix', () => {
    expect(hits('ticket_changed', '{"id": 42}', KEYS)).toEqual([
      '/teams/7/tickets',
      '/teams/7/estimates',
      '/teams/7/sprints',
      '/tickets/42',
      '/tickets/42/comments',
      '/tickets/42/events',
    ])
  })

  it('refreshes only the thread for a comment', () => {
    expect(hits('comment_added', '{"ticket_id": 42}', KEYS)).toEqual([
      '/tickets/42/comments',
      '/tickets/42/events',
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
