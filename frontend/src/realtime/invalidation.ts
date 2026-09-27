import type { Query } from '@tanstack/react-query'

import type { SseEvent } from '@/realtime/sse'

/**
 * Which cached queries a nudge makes stale (#103). Returns a predicate for
 * `invalidateQueries`, or `'all'` for a resync.
 *
 * Keys are the generated client's -- the request path first -- so this is a
 * question about paths. Everything it invalidates is refetched only if a
 * component is showing it; the rest is just marked stale for next time.
 */
export function invalidationFor(
  teamId: number,
  event: SseEvent,
): ((query: Query) => boolean) | 'all' | null {
  const path = (query: Query) => String(query.queryKey[0] ?? '')
  const team = `/teams/${teamId}`
  const ticket = (id: unknown) => {
    const root = `/tickets/${Number(id)}`
    return (p: string) => p === root || p.startsWith(`${root}/`)
  }

  switch (event.event) {
    case 'ticket_changed': {
      const id = parse(event.data)?.id
      const thisTicket = ticket(id)
      return (query) => {
        const p = path(query)
        return (
          thisTicket(p) ||
          // The board and list, and what is counted from them.
          p.startsWith(`${team}/tickets`) ||
          p === `${team}/estimates` ||
          p === `${team}/sprints` ||
          p === `${team}/projects` ||
          p.startsWith('/projects/')
        )
      }
    }
    case 'comment_added': {
      const id = parse(event.data)?.ticket_id
      const root = `/tickets/${Number(id)}`
      return (query) =>
        [`${root}/comments`, `${root}/events`, `${root}/attachments`].includes(path(query))
    }
    case 'notification':
      return (query) => path(query).startsWith('/notifications')
    case 'resync':
      return 'all'
    default:
      return null
  }
}

function parse(data: string): Record<string, unknown> | null {
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}
