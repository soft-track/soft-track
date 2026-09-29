import type { Query } from '@tanstack/react-query'

/**
 * Every cached compensation list and history (#131). A new record changes
 * the person's history, the list's current figures and its totals at once,
 * and their query keys share only this prefix.
 */
export function isCompensationQuery(query: Pick<Query, 'queryKey'>): boolean {
  return String(query.queryKey[0]).startsWith('/finance/compensation')
}
