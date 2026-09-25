import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parse,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

/**
 * The month grid and the keys that move around it (#105).
 *
 * Weeks start on Monday, matching "due this week" (#87), which runs to
 * Sunday. A month grid is a CSS grid and a date-fns loop; no calendar
 * library, for the same reason the charts are hand-rolled.
 */
const WEEK = { weekStartsOn: 1 } as const

/** `2026-09` -> the first of that month; anything else -> null. */
export function parseMonth(param: string | null): Date | null {
  if (!param || !/^\d{4}-\d{2}$/.test(param)) return null
  const date = parse(param, 'yyyy-MM', new Date())
  return isValid(date) ? date : null
}

export function monthParam(date: Date): string {
  return format(date, 'yyyy-MM')
}

/** The same `yyyy-MM-dd` the API uses for a due date. */
export function dayKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/** Whole weeks, Monday to Sunday, covering every day of the month. */
export function monthGrid(month: Date): Date[][] {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), WEEK),
    end: endOfWeek(endOfMonth(month), WEEK),
  })
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  return weeks
}

/**
 * Where a key moves the focused day, or null for a key that does not move
 * it. Arrows by day and week, Home and End to the ends of the week, and Page
 * Up and Down by a month -- the grid pattern's usual keys.
 */
export function moveDay(day: Date, key: string): Date | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(day, -1)
    case 'ArrowRight':
      return addDays(day, 1)
    case 'ArrowUp':
      return addDays(day, -7)
    case 'ArrowDown':
      return addDays(day, 7)
    case 'Home':
      return startOfWeek(day, WEEK)
    case 'End':
      return endOfWeek(day, WEEK)
    case 'PageUp':
      return addMonths(day, -1)
    case 'PageDown':
      return addMonths(day, 1)
    default:
      return null
  }
}
