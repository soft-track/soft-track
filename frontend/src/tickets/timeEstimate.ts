import type { TicketTimeEstimate } from '@/api/generated/models'
import { parseDuration } from '@/tickets/duration'

/** Time estimates in hours (#268): the arithmetic the ticket panel shares. */

/** A thousand hours: the most the API takes, so a typo is caught here. */
export const MAX_ESTIMATE_MINUTES = 1000 * 60

/** Whether a ticket has anything to work what is left out from. */
export function hasEstimate(estimate: TicketTimeEstimate | undefined): boolean {
  return estimate?.remaining_minutes !== null && estimate?.remaining_minutes !== undefined
}

/**
 * What is left once `spent` more is logged: the remaining somebody set less
 * it, or the estimate less everything logged with it. Never below nothing.
 * What the server works out when the form does not say.
 */
export function remainingAfter(estimate: TicketTimeEstimate, spent: number): number {
  if (estimate.remaining_set) return Math.max((estimate.remaining_minutes ?? 0) - spent, 0)
  return Math.max((estimate.estimated_minutes ?? 0) - estimate.logged_minutes - spent, 0)
}

/** What is left as typed: a duration, or nothing at all. */
export function parseRemaining(input: string): number | null {
  const minutes = parseDuration(input, { allowZero: true })
  return minutes !== null && minutes <= MAX_ESTIMATE_MINUTES ? minutes : null
}
