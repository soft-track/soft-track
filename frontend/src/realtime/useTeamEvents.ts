import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useSyncExternalStore } from 'react'

import { keepStreamOpen } from '@/realtime/connect'
import { invalidationFor } from '@/realtime/invalidation'
import { realtimeStatus } from '@/realtime/status'

/**
 * Keep the board live (#103): one stream for the team being looked at, whose
 * nudges invalidate the matching React Query caches. The refetching, and so
 * the rendering, is what the page already does -- no new state.
 *
 * The stream is closed while the tab is hidden. Browsers allow about six
 * connections per host over HTTP/1.1, and a stream holds one open for as long
 * as it lives; six backgrounded tabs would otherwise starve the seventh of
 * connections for its ordinary requests. Coming back reconnects, and anything
 * that happened meanwhile is caught up by refetching once.
 */
export function useTeamEvents(teamId: number | undefined): void {
  const queryClient = useQueryClient()
  const visible = usePageVisible()
  // Per team: the first connection needs no catch-up, every later one does.
  const connectedBefore = useRef<number | null>(null)

  useEffect(() => {
    if (!teamId || !visible) return
    const controller = new AbortController()

    keepStreamOpen(
      teamId,
      {
        onOpen: () => {
          realtimeStatus.opened()
          if (connectedBefore.current === teamId) {
            queryClient.invalidateQueries()
          }
          connectedBefore.current = teamId
        },
        onClose: () => realtimeStatus.closed(),
        onEvent: (event) => {
          const which = invalidationFor(teamId, event)
          if (which === 'all') queryClient.invalidateQueries()
          else if (which) queryClient.invalidateQueries({ predicate: which })
        },
      },
      controller.signal,
    )
    return () => controller.abort()
  }, [teamId, visible, queryClient])
}

function usePageVisible(): boolean {
  return useSyncExternalStore(
    (listener) => {
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
    () => document.visibilityState !== 'hidden',
    () => true,
  )
}
