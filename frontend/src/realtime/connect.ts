import { AUTH_TOKEN_STORAGE_KEY, AXIOS_INSTANCE } from '@/api/client'
import { parseSse, type SseEvent } from '@/realtime/sse'

/** Backoff between reconnects: doubling from the server's `retry:`, capped. */
const MAX_DELAY_MS = 60_000

export interface StreamHandlers {
  onEvent: (event: SseEvent) => void
  /** The stream opened -- the first time, or again after a gap. */
  onOpen: (reconnected: boolean) => void
  onClose: () => void
}

/**
 * Keep a team's event stream open until `signal` aborts (#103).
 *
 * Reconnects after a drop, backing off from the server's suggested delay.
 * Stops for good on a `close` event, a 401 (the session is over; the API
 * client's own handler takes it from there) or a 403 (no longer on the team).
 */
export async function keepStreamOpen(
  teamId: number,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const baseUrl = AXIOS_INSTANCE.defaults.baseURL ?? ''
  let delay = 5000
  let everOpened = false

  while (!signal.aborted) {
    let opened = false
    try {
      const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
      const response = await fetch(`${baseUrl}/teams/${teamId}/events`, {
        headers: {
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal,
        cache: 'no-store',
      })
      if (response.status === 401 || response.status === 403) return
      if (!response.ok || !response.body) throw new Error(`stream ${response.status}`)

      opened = true
      handlers.onOpen(everOpened)
      everOpened = true
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      let base = delay
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        const parsed = parseSse(buffer + value)
        buffer = parsed.rest
        if (parsed.retry) base = parsed.retry
        for (const event of parsed.events) {
          if (event.event === 'close') return
          handlers.onEvent(event)
        }
        // A stream that is delivering is healthy: the next drop starts the
        // backoff over rather than continuing where the last outage left it.
        delay = base
      }
    } catch {
      if (signal.aborted) return
    } finally {
      if (opened) handlers.onClose()
    }

    await sleep(delay, signal)
    delay = Math.min(delay * 2, MAX_DELAY_MS)
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}
