/**
 * The server-sent events wire format, read by hand (#103).
 *
 * `EventSource` would do this for free, but it cannot send an Authorization
 * header and this API does not put tokens in URLs. So the stream is read
 * with `fetch`, and this is the part of EventSource that has to be rebuilt:
 * frames separated by a blank line, `event:` and `data:` fields, `retry:`,
 * and `:` comments -- the heartbeats -- which carry nothing.
 */
export interface SseEvent {
  event: string
  data: string
}

export interface Parsed {
  events: SseEvent[]
  /** A frame still arriving; hand it back with the next chunk. */
  rest: string
  /** The server's reconnect delay, when a frame set one. */
  retry?: number
}

export function parseSse(buffer: string): Parsed {
  const normalised = buffer.replace(/\r\n?/g, '\n')
  const frames = normalised.split('\n\n')
  const rest = frames.pop() ?? ''
  const events: SseEvent[] = []
  let retry: number | undefined

  for (const frame of frames) {
    let event = 'message'
    const data: string[] = []
    for (const line of frame.split('\n')) {
      if (line === '' || line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
      else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value)
    }
    // A frame with no data is a heartbeat or a bare `retry:`; it dispatches
    // nothing, which is what the spec says an empty data buffer does.
    if (data.length > 0) events.push({ event, data: data.join('\n') })
  }
  return { events, rest, retry }
}
