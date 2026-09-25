import { describe, expect, it } from 'vitest'

import type { CommentRead, IssueEventRead } from '@/api/generated/models'
import { eventText, interleave } from '@/issues/detail/history'

function event(
  field: IssueEventRead['field'],
  old_value: string | null,
  new_value: string | null,
  labels: { old_label?: string | null; new_label?: string | null } = {},
): IssueEventRead {
  return { id: 1, field, old_value, new_value, created_at: '2026-09-25T10:00:00', ...labels }
}

describe('eventText', () => {
  it('puts whoever did it at the front, and Automation when nobody did', () => {
    const maya = { id: 4, full_name: 'Maya Chen' } as IssueEventRead['actor']
    expect(eventText({ ...event('status', 'started', 'done'), actor: maya })).toBe(
      'Maya Chen moved this from Started to Done',
    )
  })

  it('reads a status move as the categories history keeps', () => {
    expect(eventText(event('status', 'started', 'done'))).toBe(
      'Automation moved this from Started to Done',
    )
  })

  it('distinguishes setting, changing and removing a priority', () => {
    expect(eventText(event('priority', 'no_priority', 'urgent'))).toBe(
      'Automation set the priority to Urgent',
    )
    expect(eventText(event('priority', 'low', 'high'))).toBe(
      'Automation changed the priority from Low to High',
    )
    expect(eventText(event('priority', 'high', 'no_priority'))).toBe(
      'Automation removed the priority (was High)',
    )
  })

  it('names people, and says so when one has gone', () => {
    expect(eventText(event('assignee', null, '4', { new_label: 'Maya' }))).toBe(
      'Automation assigned this to Maya',
    )
    expect(
      eventText(event('assignee', '4', '5', { old_label: 'Maya', new_label: 'Sam' })),
    ).toBe('Automation reassigned this from Maya to Sam')
    expect(eventText(event('assignee', '4', null, { old_label: null }))).toBe(
      'Automation unassigned a former member',
    )
  })

  it('reads estimates in points, singular where it should be', () => {
    expect(eventText(event('estimate', null, '1'))).toBe('Automation estimated this at 1 point')
    expect(eventText(event('estimate', '3', '5'))).toBe(
      'Automation changed the estimate from 3 points to 5 points',
    )
    expect(eventText(event('estimate', '8', null))).toBe('Automation cleared the estimate (was 8 points)')
  })

  it('reads due-date changes as dates (#87)', () => {
    expect(eventText(event('due_date', null, '2026-09-12'))).toBe(
      'Automation set the due date to Sep 12',
    )
    expect(eventText(event('due_date', '2026-09-12', '2026-09-19'))).toBe(
      'Automation moved the due date from Sep 12 to Sep 19',
    )
    expect(eventText(event('due_date', '2026-09-19', null))).toBe(
      'Automation removed the due date (was Sep 19)',
    )
  })

  it('says where a cycle or project move went, and names deleted ones as such', () => {
    expect(eventText(event('cycle', null, '7', { new_label: 'Sprint 7' }))).toBe(
      'Automation added this to Sprint 7',
    )
    expect(eventText(event('cycle', '7', null, { old_label: 'Sprint 7' }))).toBe(
      'Automation moved this out of Sprint 7, back to the backlog',
    )
    expect(eventText(event('project', '5', null, { old_label: null }))).toBe(
      'Automation removed this from a deleted project',
    )
  })
})

describe('interleave', () => {
  const comment = (id: number, created_at: string) => ({ id, created_at }) as CommentRead
  const change = (id: number, created_at: string) =>
    ({ ...event('status', 'started', 'done'), id, created_at }) as IssueEventRead

  it('merges comments and changes oldest first', () => {
    const items = interleave(
      [comment(1, '2026-09-25T10:00:00'), comment(2, '2026-09-25T12:00:00')],
      [change(9, '2026-09-25T11:00:00')],
    )
    expect(items.map((item) => item.kind)).toEqual(['comment', 'event', 'comment'])
  })

  it('puts a change ahead of a comment made in the same instant', () => {
    const items = interleave([comment(1, '2026-09-25T10:00:00')], [change(9, '2026-09-25T10:00:00')])
    expect(items.map((item) => item.kind)).toEqual(['event', 'comment'])
  })

  it('compares times, not strings of different precision', () => {
    const items = interleave(
      [comment(1, '2026-09-25T10:00:00.5')],
      [change(9, '2026-09-25T10:00:01')],
    )
    expect(items.map((item) => item.kind)).toEqual(['comment', 'event'])
  })

  it('reads a move between teams as the keys (#98)', () => {
    expect(eventText(event('team', 'ENG-42', 'OPS-17'))).toBe(
      'Automation moved this from ENG-42 to OPS-17',
    )
  })
})
