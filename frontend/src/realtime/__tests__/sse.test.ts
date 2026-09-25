import { describe, expect, it } from 'vitest'

import { parseSse } from '@/realtime/sse'

describe('parseSse (#103)', () => {
  it('reads named events and their data', () => {
    const parsed = parseSse('event: issue_changed\ndata: {"id": 42}\n\nevent: notification\ndata: {}\n\n')
    expect(parsed.events).toEqual([
      { event: 'issue_changed', data: '{"id": 42}' },
      { event: 'notification', data: '{}' },
    ])
    expect(parsed.rest).toBe('')
  })

  it('keeps a frame that is still arriving for the next chunk', () => {
    const first = parseSse('event: issue_changed\ndata: {"id"')
    expect(first.events).toEqual([])
    const second = parseSse(first.rest + ': 7}\n\n')
    expect(second.events).toEqual([{ event: 'issue_changed', data: '{"id": 7}' }])
  })

  it('treats comments -- heartbeats -- as nothing, and reads retry', () => {
    const parsed = parseSse('retry: 5000\n: connected\n\n: ping\n\n')
    expect(parsed.events).toEqual([])
    expect(parsed.retry).toBe(5000)
  })

  it('joins multi-line data, defaults the name, and accepts CRLF', () => {
    const parsed = parseSse('data: one\r\ndata: two\r\n\r\n')
    expect(parsed.events).toEqual([{ event: 'message', data: 'one\ntwo' }])
  })
})
