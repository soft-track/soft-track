import { differenceInCalendarMonths, parseISO } from 'date-fns'

import { i18n } from '@/i18n'

/**
 * How long somebody has been here, from their start date (#126): "3 years",
 * "5 months". Nothing for a start that has not happened yet.
 */
export function tenure(startedOn: string, today = new Date()): string | null {
  const months = differenceInCalendarMonths(today, parseISO(startedOn))
  if (months < 0 || parseISO(startedOn) > today) return null
  if (months < 1) return i18n.t('people:profile.tenure.new')
  if (months < 12) return i18n.t('people:profile.tenure.months', { count: months })
  return i18n.t('people:profile.tenure.years', { count: Math.floor(months / 12) })
}
