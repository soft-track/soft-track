import { describe, expect, it } from 'vitest'

import type { ReactionSummary, UserPublic } from '@/api/generated/models'
import { chipLabel, toggled, whoReacted } from '@/issues/detail/reactions'

const me = { id: 1, full_name: 'Olivia Owner' } as UserPublic
const maya = { id: 2, full_name: 'Maya Chen' } as UserPublic
const sam = { id: 3, full_name: 'Sam Ortiz' } as UserPublic

function chip(emoji: ReactionSummary['emoji'], users: UserPublic[], meId = 1): ReactionSummary {
  return { emoji, users, count: users.length, reacted: users.some((u) => u.id === meId) }
}

describe('chipLabel', () => {
  it('says the count and what pressing it will do', () => {
    expect(chipLabel(chip('thumbs_up', [maya, sam]))).toBe(
      '👍 2 reactions, press to add yours',
    )
    expect(chipLabel(chip('heart', [me]))).toBe('❤️ 1 reaction, press to remove yours')
  })
})

describe('whoReacted', () => {
  it('lists who, with you first', () => {
    expect(whoReacted(chip('rocket', [maya, me, sam]), 1)).toBe(
      'You, Maya Chen and Sam Ortiz reacted with rocket',
    )
    expect(whoReacted(chip('eyes', [maya]), 1)).toBe('Maya Chen reacted with eyes')
    expect(whoReacted(chip('eyes', [maya, sam]), undefined)).toBe(
      'Maya Chen and Sam Ortiz reacted with eyes',
    )
  })
})

describe('toggled', () => {
  it('adds a new chip in the fixed order, not at the end', () => {
    const next = toggled([chip('eyes', [maya])], 'thumbs_up', me)
    expect(next.map((c) => c.emoji)).toEqual(['thumbs_up', 'eyes'])
    expect(next[0]).toMatchObject({ count: 1, reacted: true })
  })

  it('joins an existing chip', () => {
    const [next] = toggled([chip('heart', [maya])], 'heart', me)
    expect(next).toMatchObject({ count: 2, reacted: true })
    expect(next.users.map((u) => u.id)).toEqual([2, 1])
  })

  it('takes yours back, and drops the chip when it was the last', () => {
    const [shared] = toggled([chip('heart', [maya, me])], 'heart', me)
    expect(shared).toMatchObject({ count: 1, reacted: false })
    expect(toggled([chip('heart', [me])], 'heart', me)).toEqual([])
  })
})
