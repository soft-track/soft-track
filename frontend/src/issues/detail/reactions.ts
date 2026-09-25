import type { ReactionEmoji, ReactionSummary, UserPublic } from '@/api/generated/models'

/**
 * The eight reactions (#96), in the order the server returns them.
 *
 * The API names them; the glyph is only ever drawn here. `name` is what a
 * screen reader hears and the tooltip says -- "thumbs up", not the emoji's
 * Unicode name, which a screen reader would otherwise read out in full.
 */
export const REACTIONS: ReadonlyArray<{ emoji: ReactionEmoji; glyph: string; name: string }> = [
  { emoji: 'thumbs_up', glyph: '👍', name: 'thumbs up' },
  { emoji: 'thumbs_down', glyph: '👎', name: 'thumbs down' },
  { emoji: 'laugh', glyph: '😄', name: 'laugh' },
  { emoji: 'hooray', glyph: '🎉', name: 'hooray' },
  { emoji: 'confused', glyph: '😕', name: 'confused' },
  { emoji: 'heart', glyph: '❤️', name: 'heart' },
  { emoji: 'rocket', glyph: '🚀', name: 'rocket' },
  { emoji: 'eyes', glyph: '👀', name: 'eyes' },
]

export function reactionFor(emoji: ReactionEmoji) {
  return REACTIONS.find((reaction) => reaction.emoji === emoji)!
}

/** What a chip button says to a screen reader: the count, and what pressing does. */
export function chipLabel(summary: ReactionSummary): string {
  const { glyph } = reactionFor(summary.emoji)
  const noun = summary.count === 1 ? 'reaction' : 'reactions'
  const action = summary.reacted ? 'press to remove yours' : 'press to add yours'
  return `${glyph} ${summary.count} ${noun}, ${action}`
}

/** The tooltip: who, with "You" first when it is you. "You, Maya and Sam reacted with heart". */
export function whoReacted(summary: ReactionSummary, meId: number | undefined): string {
  const names = summary.users.map((user) => (user.id === meId ? 'You' : user.full_name))
  const ordered = [...names.filter((n) => n === 'You'), ...names.filter((n) => n !== 'You')]
  const list =
    ordered.length <= 1
      ? ordered.join('')
      : `${ordered.slice(0, -1).join(', ')} and ${ordered[ordered.length - 1]}`
  return `${list} reacted with ${reactionFor(summary.emoji).name}`
}

/**
 * The chips as they will be once the server agrees: adding or taking back
 * `emoji` for `me`. Drawn straight away so a click answers instantly; the
 * server's reply replaces it a moment later either way.
 */
export function toggled(
  summaries: readonly ReactionSummary[],
  emoji: ReactionEmoji,
  me: UserPublic,
): ReactionSummary[] {
  const existing = summaries.find((summary) => summary.emoji === emoji)
  if (existing?.reacted) {
    const users = existing.users.filter((user) => user.id !== me.id)
    return users.length === 0
      ? summaries.filter((summary) => summary !== existing)
      : summaries.map((summary) =>
          summary === existing ? { ...existing, users, count: users.length, reacted: false } : summary,
        )
  }
  if (existing) {
    return summaries.map((summary) =>
      summary === existing
        ? { ...existing, users: [...existing.users, me], count: existing.count + 1, reacted: true }
        : summary,
    )
  }
  const order = REACTIONS.map((reaction) => reaction.emoji)
  return [...summaries, { emoji, count: 1, reacted: true, users: [me] }].sort(
    (a, b) => order.indexOf(a.emoji) - order.indexOf(b.emoji),
  )
}
