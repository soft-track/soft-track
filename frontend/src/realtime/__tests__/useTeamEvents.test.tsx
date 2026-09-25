// @vitest-environment jsdom
/**
 * The stream's lifecycle (#103): open for the team on screen, closed while
 * the tab is hidden, and a refetch on the way back to cover the gap.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamHandlers } from '@/realtime/connect'
import { realtimeStatus } from '@/realtime/status'
import { useTeamEvents } from '@/realtime/useTeamEvents'

const streams: Array<{ teamId: number; handlers: StreamHandlers; signal: AbortSignal }> = []

vi.mock('@/realtime/connect', () => ({
  keepStreamOpen: (teamId: number, handlers: StreamHandlers, signal: AbortSignal) => {
    streams.push({ teamId, handlers, signal })
    return new Promise<void>(() => {})
  },
}))

let hidden = false
function setHidden(value: boolean) {
  hidden = value
  document.dispatchEvent(new Event('visibilitychange'))
}

function Board({ teamId }: { teamId: number }) {
  useTeamEvents(teamId)
  return null
}

beforeEach(() => {
  streams.length = 0
  hidden = false
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  })
})

afterEach(cleanup)

describe('useTeamEvents', () => {
  it('turns a nudge into an invalidation of the right queries', () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    render(
      <QueryClientProvider client={client}>
        <Board teamId={7} />
      </QueryClientProvider>,
    )
    const [{ handlers }] = streams
    act(() => handlers.onOpen(false))
    expect(invalidate).not.toHaveBeenCalled()

    act(() => handlers.onEvent({ event: 'issue_changed', data: '{"id": 42}' }))
    const [{ predicate }] = invalidate.mock.calls[0] as [{ predicate: (q: unknown) => boolean }]
    expect(predicate({ queryKey: ['/issues/42'] })).toBe(true)
    expect(predicate({ queryKey: ['/issues/43'] })).toBe(false)

    act(() => handlers.onEvent({ event: 'resync', data: '{}' }))
    expect(invalidate).toHaveBeenLastCalledWith()
    act(() => handlers.onClose())
  })

  it('closes while hidden, and catches up when the tab comes back', () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    render(
      <QueryClientProvider client={client}>
        <Board teamId={7} />
      </QueryClientProvider>,
    )
    act(() => streams[0].handlers.onOpen(false))
    expect(realtimeStatus.isConnected()).toBe(true)

    act(() => setHidden(true))
    expect(streams[0].signal.aborted).toBe(true)
    act(() => streams[0].handlers.onClose())
    expect(realtimeStatus.isConnected()).toBe(false)

    act(() => setHidden(false))
    expect(streams).toHaveLength(2)
    act(() => streams[1].handlers.onOpen(false))
    // Whatever happened while it was hidden, it has now missed: refetch.
    expect(invalidate).toHaveBeenCalledWith()
    act(() => streams[1].handlers.onClose())
  })

  it('opens a stream for the new team when the team changes', () => {
    const client = new QueryClient()
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <Board teamId={7} />
      </QueryClientProvider>,
    )
    rerender(
      <QueryClientProvider client={client}>
        <Board teamId={8} />
      </QueryClientProvider>,
    )
    expect(streams.map((s) => [s.teamId, s.signal.aborted])).toEqual([
      [7, true],
      [8, false],
    ])
  })
})
