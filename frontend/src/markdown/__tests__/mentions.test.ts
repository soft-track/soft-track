import { describe, expect, it } from 'vitest'

import {
  MENTION_PATTERN,
  type Mentionable,
  matchMentions,
  mentionHandles,
  peopleByHandle,
} from '../mentions'

const people: Mentionable[] = [
  { id: 1, full_name: 'Demo User', email: 'demo@softtrack.dev' },
  { id: 2, full_name: 'Ada Lovelace', email: 'ada.lovelace@softtrack.dev' },
  { id: 3, full_name: 'Grace Hopper', email: 'Grace+work@softtrack.dev' },
]

function matches(text: string): string[] {
  return [...text.matchAll(MENTION_PATTERN)].map((m) => m[2])
}

describe('mentionHandles', () => {
  it('uses the local part of the address', () => {
    const handles = mentionHandles(people)
    expect(handles.get(1)).toBe('demo')
    expect(handles.get(2)).toBe('ada.lovelace')
  })

  it('lowercases and replaces characters a handle cannot contain', () => {
    expect(mentionHandles(people).get(3)).toBe('grace-work')
  })

  it('falls back to the full address when local parts collide', () => {
    const colliding: Mentionable[] = [
      { id: 1, full_name: 'Sam A', email: 'sam@a.example' },
      { id: 2, full_name: 'Sam B', email: 'sam@b.example' },
      { id: 3, full_name: 'Ada', email: 'ada@a.example' },
    ]
    const handles = mentionHandles(colliding)

    expect(handles.get(1)).toBe('sam@a.example')
    expect(handles.get(2)).toBe('sam@b.example')
    // A handle that does not collide is left alone.
    expect(handles.get(3)).toBe('ada')
  })

  it('does not depend on the order people arrive in', () => {
    const colliding: Mentionable[] = [
      { id: 1, full_name: 'Sam A', email: 'sam@a.example' },
      { id: 2, full_name: 'Sam B', email: 'sam@b.example' },
    ]
    const forwards = mentionHandles(colliding)
    const backwards = mentionHandles([...colliding].reverse())

    expect([...forwards.entries()].sort()).toEqual([...backwards.entries()].sort())
  })

  it('round-trips through peopleByHandle', () => {
    const byHandle = peopleByHandle(people)
    expect(byHandle.get('demo')?.id).toBe(1)
    expect(byHandle.get('ada.lovelace')?.full_name).toBe('Ada Lovelace')
    expect(byHandle.get('nobody')).toBeUndefined()
  })
})

describe('MENTION_PATTERN', () => {
  it('finds a mention at the start of a line and mid-sentence', () => {
    expect(matches('@demo can you look at this')).toEqual(['demo'])
    expect(matches('ping @ada.lovelace about it')).toEqual(['ada.lovelace'])
  })

  it('finds several in one line', () => {
    expect(matches('@demo and @ada.lovelace')).toEqual(['demo', 'ada.lovelace'])
  })

  it('does not read a plain email address as a mention of its domain', () => {
    expect(matches('write to demo@softtrack.dev instead')).toEqual([])
  })

  it('matches a full address when that is the handle', () => {
    expect(matches('@sam@a.example please review')).toEqual(['sam@a.example'])
  })

  it('ignores an @ inside a path', () => {
    expect(matches('see /users/@demo')).toEqual([])
  })
})

describe('matchMentions', () => {
  it('matches on handle and on name', () => {
    expect(matchMentions(people, 'ada').map((p) => p.id)).toEqual([2])
    expect(matchMentions(people, 'hopper').map((p) => p.id)).toEqual([3])
  })

  it('is case insensitive', () => {
    expect(matchMentions(people, 'ADA').map((p) => p.id)).toEqual([2])
  })

  it('returns everyone for an empty query, capped at the limit', () => {
    expect(matchMentions(people, '')).toHaveLength(3)
    expect(matchMentions(people, '', 2)).toHaveLength(2)
  })

  it('returns nothing when there is no match', () => {
    expect(matchMentions(people, 'zzz')).toEqual([])
  })
})
