import { describe, expect, it } from 'vitest'

import {
  MENTION_PATTERN,
  type Mentionable,
  matchMentions,
  mentionHandles,
  peopleByHandle,
} from '@/markdown/mentions'

const people: Mentionable[] = [
  { id: 1, full_name: 'Demo User', email: 'demo@softtrack.dev', username: 'demo' },
  {
    id: 2,
    full_name: 'Ada Lovelace',
    email: 'ada.lovelace@softtrack.dev',
    username: 'ada.lovelace',
  },
  { id: 3, full_name: 'Grace Hopper', email: 'grace@softtrack.dev', username: 'grace-work' },
]

function matches(text: string): string[] {
  return [...text.matchAll(MENTION_PATTERN)].map((m) => m[2])
}

describe('mentionHandles', () => {
  it('uses the stored username', () => {
    const handles = mentionHandles(people)
    expect(handles.get(1)).toBe('demo')
    expect(handles.get(2)).toBe('ada.lovelace')
    expect(handles.get(3)).toBe('grace-work')
  })

  it('lowercases the handle', () => {
    expect(mentionHandles([{ ...people[0], username: 'Demo' }]).get(1)).toBe('demo')
  })

  it('does not depend on the order people arrive in', () => {
    const forwards = mentionHandles(people)
    const backwards = mentionHandles([...people].reverse())
    expect([...forwards.entries()].sort()).toEqual([...backwards.entries()].sort())
  })

  it('round-trips through peopleByHandle', () => {
    const byHandle = peopleByHandle(people)
    expect(byHandle.get('demo')?.id).toBe(1)
    expect(byHandle.get('ada.lovelace')?.full_name).toBe('Ada Lovelace')
    expect(byHandle.get('nobody')).toBeUndefined()
  })

  it('follows the person, not their address', () => {
    // The point of the username column: the same handle after a change of
    // email still resolves to the same person.
    const renamed = [{ ...people[1], email: 'ada@newdomain.dev' }]
    expect(peopleByHandle(renamed).get('ada.lovelace')?.id).toBe(2)
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

  it('ignores an @ inside a path', () => {
    expect(matches('see /users/@demo')).toEqual([])
  })

  it('accepts every character a username may contain', () => {
    expect(matches('@grace-work @a.b_c')).toEqual(['grace-work', 'a.b_c'])
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
