import { describe as group, expect, it } from 'vitest'

import type { NotificationRead } from '@/api/generated/models'
import {
  badgeLabel,
  describe,
  reminderDetail,
  unreadAnnouncement,
} from '@/notifications/notificationMeta'

const base: NotificationRead = {
  id: 1,
  kind: 'commented',
  ticket: {
    id: 7,
    team_id: 1,
    team_key: 'ENG',
    number: 42,
    identifier: 'ENG-42',
    title: 'The bug',
  },
  actor: {
    id: 2,
    email: 'sam@example.com',
    username: 'sam',
    full_name: 'Sam Rivera',
    avatar_color: '#6366f1',
    is_active: true,
  },
  excerpt: 'Reproduced on staging',
  read: false,
  created_at: '2026-09-08T09:00:00',
}

group('describe', () => {
  it('names the person and what they did', () => {
    expect(describe(base)).toBe('Sam Rivera commented')
    expect(describe({ ...base, kind: 'assigned' })).toBe('Sam Rivera assigned this to you')
    expect(describe({ ...base, kind: 'mentioned' })).toBe('Sam Rivera mentioned you')
  })

  it('says which of the team’s fields someone was named in (#117)', () => {
    expect(describe({ ...base, kind: 'field_assigned', field_name: 'Reviewer' })).toBe(
      'Sam Rivera set you as Reviewer',
    )
    expect(
      describe({ ...base, kind: 'field_assigned', field_name: 'QA assignee', actor: null }),
    ).toBe('Set you as QA assignee')
  })

  it('reads as a sentence when nobody did it', () => {
    // An import has no actor; "Someone changed the status" would be a claim
    // about a person who does not exist.
    expect(describe({ ...base, kind: 'status_changed', actor: null })).toBe(
      'Changed the status',
    )
  })
})

group('a due-date reminder (#262)', () => {
  const reminder: NotificationRead = {
    ...base,
    kind: 'due_tomorrow',
    actor: null,
    excerpt: null,
    due_date: '2026-10-04',
    assigned_to_you: true,
    created_at: '2026-10-03T08:00:00',
  }

  it('says what is due, and when', () => {
    expect(describe(reminder)).toBe('Due tomorrow')
    expect(reminderDetail(reminder)).toBe('Due 4 Oct, and assigned to you.')
    // An unassigned ticket reminds its watchers, whose it is not.
    expect(reminderDetail({ ...reminder, assigned_to_you: false })).toBe('Due 4 Oct.')
  })

  it('is overdue the day after, and still overdue a week later', () => {
    const late = {
      ...reminder,
      kind: 'overdue' as const,
      due_date: '2026-09-29',
      created_at: '2026-09-30T08:00:00',
    }
    expect(describe(late)).toBe('Overdue')
    expect(reminderDetail(late)).toBe('Was due 29 Sep.')
    expect(describe({ ...late, created_at: '2026-10-07T08:00:00' })).toBe('Still overdue')
  })

  it('has no detail line on anything a person did', () => {
    expect(reminderDetail(base)).toBeNull()
  })
})

group('badgeLabel', () => {
  it('stops counting past nine', () => {
    expect(badgeLabel(0)).toBe('0')
    expect(badgeLabel(9)).toBe('9')
    expect(badgeLabel(10)).toBe('9+')
  })
})

group('unreadAnnouncement', () => {
  it('reads as a sentence, with the exact count', () => {
    expect(unreadAnnouncement(1)).toBe('1 unread notification')
    expect(unreadAnnouncement(3)).toBe('3 unread notifications')
    expect(unreadAnnouncement(12)).toBe('12 unread notifications')
  })

  it('says nothing for zero, since nothing arriving is not news', () => {
    expect(unreadAnnouncement(0)).toBe('')
  })
})
