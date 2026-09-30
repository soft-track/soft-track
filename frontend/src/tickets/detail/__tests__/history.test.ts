import { describe, expect, it } from 'vitest'

import type { CommentRead, CustomFieldKind, TicketEventRead } from '@/api/generated/models'
import { eventText, interleave } from '@/tickets/detail/history'

function event(
  field: TicketEventRead['field'],
  old_value: string | null,
  new_value: string | null,
  labels: { old_label?: string | null; new_label?: string | null } = {},
): TicketEventRead {
  return { id: 1, field, old_value, new_value, created_at: '2026-09-25T10:00:00', ...labels }
}

describe('eventText', () => {
  it('puts whoever did it at the front, and Automation when nobody did', () => {
    const maya = { id: 4, full_name: 'Maya Chen' } as TicketEventRead['actor']
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

  it('says where a sprint or project move went, and names deleted ones as such', () => {
    expect(eventText(event('sprint', null, '7', { new_label: 'Sprint 7' }))).toBe(
      'Automation added this to Sprint 7',
    )
    expect(eventText(event('sprint', '7', null, { old_label: 'Sprint 7' }))).toBe(
      'Automation moved this out of Sprint 7, back to the backlog',
    )
    expect(eventText(event('project', '5', null, { old_label: null }))).toBe(
      'Automation removed this from a deleted epic',
    )
  })
})

describe('eventText for the team’s own fields (#117)', () => {
  function fieldEvent(
    kind: CustomFieldKind,
    old_value: string | null,
    new_value: string | null,
    labels: { old_label?: string | null; new_label?: string | null } = {},
  ): TicketEventRead {
    return {
      ...event('custom_field', old_value, new_value, labels),
      custom_field: { id: 3, key: 'field', name: 'Reviewer', kind },
    }
  }

  it('names the field, and the person as they are called now', () => {
    expect(eventText(fieldEvent('user', null, '4', { new_label: 'Maya' }))).toBe(
      'Automation set Reviewer to Maya',
    )
    expect(
      eventText(fieldEvent('user', '4', '5', { old_label: 'Maya', new_label: 'Sam' })),
    ).toBe('Automation changed Reviewer from Maya to Sam')
    expect(eventText(fieldEvent('user', '4', null, { old_label: null }))).toBe(
      'Automation cleared Reviewer (was a former member)',
    )
  })

  it('reads options by name, and one since removed as such', () => {
    expect(
      eventText(fieldEvent('select', 'prod', 'dev', { old_label: 'Production', new_label: null })),
    ).toBe('Automation changed Reviewer from Production to a removed option')
    expect(eventText(fieldEvent('multi_select', null, '["ios","web"]', { new_label: 'iOS, Web' }))).toBe(
      'Automation set Reviewer to iOS, Web',
    )
  })

  it('reads text as written, and dates and numbers the interface’s way', () => {
    expect(eventText(fieldEvent('text', null, 'Acme Logistics'))).toBe(
      'Automation set Reviewer to Acme Logistics',
    )
    expect(eventText(fieldEvent('date', null, '2026-10-03'))).toBe(
      'Automation set Reviewer to Oct 3',
    )
    expect(eventText(fieldEvent('number', '1500', '2500.5'))).toBe(
      'Automation changed Reviewer from 1,500 to 2,500.5',
    )
  })

  it('ticks and unticks a checkbox', () => {
    expect(eventText(fieldEvent('checkbox', null, 'true'))).toBe('Automation ticked Reviewer')
    expect(eventText(fieldEvent('checkbox', 'true', null))).toBe('Automation unticked Reviewer')
  })
})

describe('interleave', () => {
  const comment = (id: number, created_at: string) => ({ id, created_at }) as CommentRead
  const change = (id: number, created_at: string) =>
    ({ ...event('status', 'started', 'done'), id, created_at }) as TicketEventRead

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

  it('says when it went into the trash and came back out (#323)', () => {
    const mei = { id: 7, full_name: 'Mei Tanaka' } as TicketEventRead['actor']
    expect(
      eventText({ ...event('trash', null, '2026-09-28T10:00:00+00:00'), actor: mei }),
    ).toBe('Mei Tanaka moved this to the trash')
    expect(
      eventText({ ...event('trash', '2026-09-28T10:00:00+00:00', null), actor: mei }),
    ).toBe('Mei Tanaka restored this from the trash')
  })

  it('reads a move between teams as the keys (#98)', () => {
    expect(eventText(event('team', 'ENG-42', 'OPS-17'))).toBe(
      'Automation moved this from ENG-42 to OPS-17',
    )
  })
})
