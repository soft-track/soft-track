import { useSyncExternalStore } from 'react'

/**
 * Whether a live stream is open right now (#103), for the parts of the page
 * that poll when it is not -- the notification badge.
 *
 * A module-level store rather than context: the stream is opened by the
 * board and the badge sits in its top bar, and nothing else needs to know.
 * Counted rather than a flag, so two streams opening and one closing does not
 * read as "offline".
 */
let open = 0
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export const realtimeStatus = {
  opened() {
    open += 1
    emit()
  },
  closed() {
    open = Math.max(0, open - 1)
    emit()
  },
  isConnected: () => open > 0,
}

export function useRealtimeConnected(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    realtimeStatus.isConnected,
    () => false,
  )
}
