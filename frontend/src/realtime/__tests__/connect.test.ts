import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AUTH_TOKEN_STORAGE_KEY } from '@/api/client'
import { keepStreamOpen } from '@/realtime/connect'

function streamOf(...chunks: string[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const storage = new Map<string, string>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  })
  storage.set(AUTH_TOKEN_STORAGE_KEY, 'tok')
})

afterEach(() => vi.unstubAllGlobals())

function handlers() {
  return { onEvent: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() }
}

describe('keepStreamOpen (#103)', () => {
  it('sends the bearer header, delivers events, and stops on close', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      streamOf('retry: 5000\n: connected\n\n', 'event: issue_changed\ndata: {"id": 4', '2}\n\n', 'event: close\ndata: {}\n\n'),
    )
    vi.stubGlobal('fetch', fetchMock)
    const h = handlers()

    await keepStreamOpen(7, h, new AbortController().signal)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/teams\/7\/events$/)
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(h.onEvent).toHaveBeenCalledWith({ event: 'issue_changed', data: '{"id": 42}' })
    expect(h.onOpen).toHaveBeenCalledWith(false)
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })

  it('reconnects after a drop, as a reconnection', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(streamOf('retry: 1\n\n'))
      .mockResolvedValueOnce(streamOf('event: close\ndata: {}\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    const h = handlers()

    await keepStreamOpen(7, h, new AbortController().signal)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(h.onOpen.mock.calls).toEqual([[false], [true]])
    expect(h.onClose).toHaveBeenCalledTimes(2)
  })

  it('gives up for good on 403 or 401', async () => {
    for (const status of [401, 403]) {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }))
      vi.stubGlobal('fetch', fetchMock)
      const h = handlers()
      await keepStreamOpen(7, h, new AbortController().signal)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(h.onOpen).not.toHaveBeenCalled()
    }
  })

  it('stops when aborted, even while waiting to reconnect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))
    const controller = new AbortController()
    const done = keepStreamOpen(7, handlers(), controller.signal)
    controller.abort()
    await expect(done).resolves.toBeUndefined()
  })
})
