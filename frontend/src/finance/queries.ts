import type { Query } from '@tanstack/react-query'

/**
 * Every cached finance query (#131, #132). Finance pages read each other: a
 * pay recorded changes the compensation list, the person's history and every
 * draft payroll run at once, and their query keys share only this prefix.
 */
export function isFinanceQuery(query: Pick<Query, 'queryKey'>): boolean {
  return String(query.queryKey[0]).startsWith('/finance/')
}
