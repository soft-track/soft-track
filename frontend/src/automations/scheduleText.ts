import { parseISO } from 'date-fns'

import type { ScheduleFields, ScheduleRead } from '@/api/generated/models'
import { i18n } from '@/i18n'
import { formatDate, formatList } from '@/i18n/format'

/**
 * A recurring ticket's schedule (#264), read back in words: "Every Monday ·
 * a task for Daniel Okafor, in the active sprint".
 *
 * Pure, like ruleText.ts beside it, so the row and the dialog's preview say
 * the same thing and it can be tested without a DOM. The words are in
 * `settings:schedules`.
 */

/** Monday is 0, as the API counts them. A Monday to name the days by. */
const A_MONDAY = new Date(2024, 0, 1)

export function weekdayName(day: number, pattern: 'EEEE' | 'EEE' = 'EEEE'): string {
  return formatDate(new Date(2024, 0, 1 + day), pattern)
}

export function monthName(month: number): string {
  return formatDate(new Date(A_MONDAY.getFullYear(), month - 1, 1), 'MMMM')
}

/** How often: "Every Monday", "Every quarter, on the first working day". */
export function describeRepeat(schedule: ScheduleFields): string {
  const t = i18n.t
  const weekdays = schedule.weekdays ?? []
  switch (schedule.frequency) {
    case 'daily':
      return t('settings:schedules.repeat.daily')
    case 'weekly': {
      const days = formatList(weekdays.map((day) => weekdayName(day)))
      const interval = schedule.interval ?? 1
      if (interval > 1) return t('settings:schedules.repeat.everyWeeks', { count: interval, days })
      if (weekdays.join() === '0,1,2,3,4') return t('settings:schedules.repeat.weekdays')
      return t('settings:schedules.repeat.weekly', { days })
    }
    default: {
      const day = monthDay(schedule)
      if (schedule.frequency === 'monthly') return t('settings:schedules.repeat.monthly', { day })
      if (schedule.frequency === 'quarterly')
        return t('settings:schedules.repeat.quarterly', { day })
      const month = monthName(schedule.month ?? 1)
      if (schedule.month_day === 'date') {
        const date = formatDate(new Date(2024, (schedule.month ?? 1) - 1, schedule.day_of_month ?? 1), 'd MMMM')
        return t('settings:schedules.repeat.yearlyDate', { date })
      }
      return t('settings:schedules.repeat.yearlyIn', { day, month })
    }
  }
}

function monthDay(schedule: ScheduleFields): string {
  if (schedule.month_day === 'first_working_day')
    return i18n.t('settings:schedules.monthDay.first_working_day')
  if (schedule.month_day === 'last_working_day')
    return i18n.t('settings:schedules.monthDay.last_working_day')
  return i18n.t('settings:schedules.monthDay.date', {
    count: schedule.day_of_month ?? 1,
    ordinal: true,
  })
}

/** What it creates: "a task for Daniel Okafor, in the active sprint". */
export function describeWhat(schedule: ScheduleFields, assigneeName: string | null): string {
  const t = i18n.t
  const what = t(`settings:schedules.what.${schedule.type ?? 'task'}`)
  const parts: string[] = [
    assigneeName
      ? t('settings:schedules.what.for', { what, name: assigneeName })
      : t('settings:schedules.what.unassigned', { what }),
    schedule.into_active_sprint
      ? t('settings:schedules.what.sprint')
      : t('settings:schedules.what.backlog'),
  ]
  const due = schedule.due_after_days
  if (due != null) {
    parts.push(
      due === 0
        ? t('settings:schedules.what.dueSameDay')
        : t('settings:schedules.what.due', { count: due }),
    )
  }
  return parts.join(', ')
}

/** The row's sentence: "Every Monday · a task for Daniel Okafor, in the backlog". */
export function describeSchedule(schedule: ScheduleRead): string {
  return i18n.t('settings:schedules.line', {
    when: describeRepeat(schedule),
    what: describeWhat(schedule, schedule.assignee?.full_name ?? null),
  })
}

/** "Mon 5 Oct": the day it creates its next ticket on. */
export function nextDay(date: string): string {
  return formatDate(parseISO(date), i18n.t('settings:schedules.nextPattern'))
}
