// @vitest-environment jsdom
/**
 * Who an assignee picker offers (#316): members, with the team's guests shown
 * in a group of their own that cannot be chosen.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { TeamMemberRead, TeamRole } from '@/api/generated/models'
import { AssigneeOptions } from '@/tickets/AssigneeOptions'

function member(id: number, full_name: string, role: TeamRole, is_active = true): TeamMemberRead {
  return {
    role,
    joined_at: '2026-01-01T00:00:00Z',
    user: { id, email: `${id}@example.com`, username: `u${id}`, full_name, avatar_color: '#123', is_active },
  }
}

const MEMBERS = [
  member(1, 'Amina Khan', 'admin'),
  member(2, 'Daniel Okafor', 'member'),
  member(3, 'Mei Tanaka', 'member', false),
  member(4, 'Sofia Marin', 'guest'),
  member(5, 'Carlos Rivera', 'guest'),
]

function renderPicker(value: string, keepId?: number) {
  render(
    <select aria-label="Assignee" value={value} onChange={() => {}}>
      <option value="">Unassigned</option>
      <AssigneeOptions members={MEMBERS} keepId={keepId} />
    </select>,
  )
  return screen.getByRole<HTMLSelectElement>('combobox', { name: 'Assignee' })
}

afterEach(cleanup)

describe('AssigneeOptions', () => {
  it('offers members and lists guests apart, where they cannot be chosen', () => {
    const picker = renderPicker('')
    expect([...picker.options].map((o) => [o.text, o.disabled])).toEqual([
      ['Unassigned', false],
      ['Amina Khan', false],
      ['Daniel Okafor', false],
      ['Sofia Marin', true],
      ['Carlos Rivera', true],
    ])
    const group = picker.querySelector('optgroup')!
    expect(group.label).toBe('Guests · read-only')
    expect([...group.querySelectorAll('option')].map((o) => o.text)).toEqual([
      'Sofia Marin',
      'Carlos Rivera',
    ])
  })

  it('keeps whoever holds the ticket already, guest or deactivated', () => {
    expect(renderPicker('5', 5).selectedOptions[0].text).toBe('Carlos Rivera')
    cleanup()
    const picker = renderPicker('3', 3)
    expect(picker.selectedOptions[0].text).toBe('Mei Tanaka')
    expect(picker.selectedOptions[0].disabled).toBe(false)
  })
})
