import type { Query } from '@tanstack/react-query'

/**
 * Every cached finance query (#131, #132). Finance pages read each other: a
 * pay recorded changes the compensation list, the person's history and every
 * draft payroll run at once, and their query keys share only this prefix.
 */
export function isFinanceQuery(query: Pick<Query, 'queryKey'>): boolean {
  return String(query.queryKey[0]).startsWith('/finance/')
}

/**
 * Everything an expense claim appears in (#133): the submitter's own list,
 * and finance's queue and panel.
 */
export function isExpenseQuery(query: Pick<Query, 'queryKey'>): boolean {
  const key = String(query.queryKey[0])
  return key.startsWith('/expenses') || key.startsWith('/finance/expenses')
}
