/** A recurring ticket's schedule read back in words (#264). */
import { describe, expect, it } from 'vitest'

import type { ScheduleFields } from '@/api/generated/models'
import { describeRepeat, describeWhat } from '@/automations/scheduleText'

const base: ScheduleFields = { title: 'x', frequency: 'daily' }

describe('describeRepeat', () => {
  it('says how often, the way the mockup does', () => {
    expect(describeRepeat({ ...base, frequency: 'weekly', weekdays: [0] })).toBe('Every Monday')
    expect(describeRepeat({ ...base, frequency: 'weekly', weekdays: [0, 3] })).toBe(
      'Every Monday and Thursday',
    )
    expect(describeRepeat({ ...base, frequency: 'weekly', weekdays: [0, 1, 2, 3, 4] })).toBe(
      'Every weekday',
    )
    expect(describeRepeat({ ...base, frequency: 'weekly', weekdays: [0], interval: 6 })).toBe(
      'Every 6 weeks, on Monday',
    )
    expect(
      describeRepeat({ ...base, frequency: 'quarterly', month_day: 'first_working_day' }),
    ).toBe('Every quarter, on the first working day')
    expect(describeRepeat({ ...base, frequency: 'monthly', month_day: 'last_working_day' })).toBe(
      'Every month, on the last working day',
    )
    expect(
      describeRepeat({ ...base, frequency: 'monthly', month_day: 'date', day_of_month: 22 }),
    ).toBe('Every month, on the 22nd')
    expect(
      describeRepeat({
        ...base,
        frequency: 'yearly',
        month_day: 'date',
        day_of_month: 15,
        month: 3,
      }),
    ).toBe('Every year, on 15 March')
    expect(describeRepeat(base)).toBe('Every day')
  })
})

describe('describeWhat', () => {
  it('names the type, who it is for, where it lands and when it is due', () => {
    expect(describeWhat({ ...base, type: 'task', into_active_sprint: true }, 'Daniel Okafor')).toBe(
      'a task for Daniel Okafor, in the active sprint',
    )
    expect(describeWhat({ ...base, type: 'story', due_after_days: 2 }, null)).toBe(
      'a story, unassigned, in the backlog, due 2 days later',
    )
  })
})
