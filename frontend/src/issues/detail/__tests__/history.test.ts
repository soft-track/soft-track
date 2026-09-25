import { describe, expect, it } from 'vitest'

import type { CommentRead, IssueEventRead } from '@/api/generated/models'
import { describeEvent, interleave } from '@/issues/detail/history'

function event(
  field: IssueEventRead['field'],
  old_value: string | null,
  new_value: string | null,
  labels: { old_label?: string | null; new_label?: string | null } = {},
): IssueEventRead {
  return { id: 1, field, old_value, new_value, created_at: '2026-09-25T10:00:00', ...labels }
}

describe('describeEvent', () => {
  it('reads a status move as the categories history keeps', () => {
    expect(describeEvent(event('status', 'started', 'done'))).toBe(
      'moved this from Started to Done',
    )
  })

  it('distinguishes setting, changing and removing a priority', () => {
    expect(describeEvent(event('priority', 'no_priority', 'urgent'))).toBe(
      'set the priority to Urgent',
    )
    expect(describeEvent(event('priority', 'low', 'high'))).toBe(
      'changed the priority from Low to High',
    )
    expect(describeEvent(event('priority', 'high', 'no_priority'))).toBe(
      'removed the priority (was High)',
    )
  })

  it('names people, and says so when one has gone', () => {
    expect(describeEvent(event('assignee', null, '4', { new_label: 'Maya' }))).toBe(
      'assigned this to Maya',
    )
    expect(
      describeEvent(event('assignee', '4', '5', { old_label: 'Maya', new_label: 'Sam' })),
    ).toBe('reassigned this from Maya to Sam')
    expect(describeEvent(event('assignee', '4', null, { old_label: null }))).toBe(
      'unassigned a former member',
    )
  })

  it('reads estimates in points, singular where it should be', () => {
    expect(describeEvent(event('estimate', null, '1'))).toBe('estimated this at 1 point')
    expect(describeEvent(event('estimate', '3', '5'))).toBe(
      'changed the estimate from 3 points to 5 points',
    )
    expect(describeEvent(event('estimate', '8', null))).toBe('cleared the estimate (was 8 points)')
  })

  it('says where a cycle or project move went, and names deleted ones as such', () => {
    expect(describeEvent(event('cycle', null, '7', { new_label: 'Sprint 7' }))).toBe(
      'added this to Sprint 7',
    )
    expect(describeEvent(event('cycle', '7', null, { old_label: 'Sprint 7' }))).toBe(
      'moved this out of Sprint 7, back to the backlog',
    )
    expect(describeEvent(event('project', '5', null, { old_label: null }))).toBe(
      'removed this from a deleted project',
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
})
