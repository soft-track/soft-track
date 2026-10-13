import { describe, expect, it } from 'vitest'

import type { CustomFieldRead } from '@/api/generated/models'
import {
  displayValue,
  editableFields,
  isFilled,
  keyFromName,
  missingRequired,
  shortUrl,
  toInput,
} from '@/tickets/customFields'

function field(key: string, extra: Partial<CustomFieldRead> = {}): CustomFieldRead {
  return {
    id: key.length,
    team_id: 7,
    key,
    name: key,
    kind: 'text',
    options: [],
    required: false,
    applies_to: [],
    position: 0,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

const MAYA = {
  id: 4,
  email: 'maya@example.com',
  username: 'maya',
  full_name: 'Maya Chen',
  avatar_color: '#123',
  is_active: true,
}

describe('editableFields', () => {
  it('offers the fields a ticket of the type has, and never an archived one', () => {
    const fields = [
      field('everywhere'),
      field('bugs', { applies_to: ['bug'] }),
      field('gone', { archived_at: '2026-08-02T10:00:00Z' }),
    ]
    expect(editableFields(fields, 'task').map((f) => f.key)).toEqual(['everywhere'])
    expect(editableFields(fields, 'bug').map((f) => f.key)).toEqual(['everywhere', 'bugs'])
  })
})

describe('missingRequired', () => {
  it('names the required fields left empty, the way the API does', () => {
    const fields = [
      field('qa', { required: true }),
      field('environment', { required: true, applies_to: ['bug'] }),
      field('checked', { required: true, kind: 'checkbox' }),
    ]
    expect(missingRequired(fields, 'task', { qa: 3 }).map((f) => f.key)).toEqual(['checked'])
    expect(
      missingRequired(fields, 'bug', { qa: 3, environment: '', checked: false }).map((f) => f.key),
    ).toEqual(['environment', 'checked'])
    expect(missingRequired(fields, 'task', { qa: 3, checked: true })).toEqual([])
  })
})

describe('isFilled and toInput', () => {
  it('treats an unticked box and an empty list as nothing', () => {
    expect([false, '', [], null, undefined].map(isFilled)).toEqual([false, false, false, false, false])
    expect([true, 0, 'x', ['a']].map(isFilled)).toEqual([true, true, true, true])
  })

  it('sends a person back as their id', () => {
    expect(toInput(MAYA)).toBe(4)
    expect(toInput(['a'])).toEqual(['a'])
    expect(toInput(undefined)).toBeNull()
  })
})

describe('displayValue', () => {
  it('reads every kind as one line', () => {
    const platforms = field('platforms', {
      kind: 'multi_select',
      options: [
        { id: 'ios', name: 'iOS' },
        { id: 'web', name: 'Web' },
      ],
    })
    expect(displayValue(field('reviewer', { kind: 'user' }), MAYA)).toBe('Maya Chen')
    expect(displayValue(platforms, ['ios', 'web'])).toBe('iOS and Web')
    expect(displayValue(field('done', { kind: 'checkbox' }), true)).toBe('Yes')
    expect(displayValue(field('when', { kind: 'date' }), '2026-10-03')).toBe('Oct 3')
    expect(displayValue(field('points', { kind: 'number' }), 12500)).toBe('12,500')
  })
})

describe('shortUrl', () => {
  it('keeps the host and the last part of the path', () => {
    expect(shortUrl('https://sentry.io/organizations/acme/issues/48213')).toBe('sentry.io/…/48213')
    expect(shortUrl('https://www.example.com/docs')).toBe('example.com/docs')
    expect(shortUrl('https://example.com/')).toBe('example.com')
    expect(shortUrl('not a link')).toBe('not a link')
  })
})

describe('keyFromName', () => {
  it('makes the key the API would', () => {
    expect(keyFromName('QA assignee')).toBe('qa_assignee')
    expect(keyFromName('  Sentry URL!  ')).toBe('sentry_url')
    expect(keyFromName('2nd reviewer')).toBe('field_2nd_reviewer')
    expect(keyFromName('レビュー')).toBe('field')
  })
})
