import type { ReactionEmoji, ReactionSummary, UserPublic } from '@/api/generated/models'
import { i18n } from '@/i18n'
import { formatList } from '@/i18n/format'

/**
 * The eight reactions (#96), in the order the server returns them.
 *
 * The API names them; the glyph is only ever drawn here. `name` is what a
 * screen reader hears and the tooltip says -- "thumbs up", not the emoji's
 * Unicode name, which a screen reader would otherwise read out in full. It is
 * a getter over the catalog (#106), so it is always the current language's.
 */
export const REACTIONS: ReadonlyArray<{
  emoji: ReactionEmoji
  glyph: string
  readonly name: string
}> = [
  reaction('thumbs_up', '👍'),
  reaction('thumbs_down', '👎'),
  reaction('laugh', '😄'),
  reaction('hooray', '🎉'),
  reaction('confused', '😕'),
  reaction('heart', '❤️'),
  reaction('rocket', '🚀'),
  reaction('eyes', '👀'),
]

function reaction(emoji: ReactionEmoji, glyph: string) {
  return {
    emoji,
    glyph,
    get name() {
      return i18n.t(`issues:comments.reactions.name.${emoji}`)
    },
  }
}

export function reactionFor(emoji: ReactionEmoji) {
  return REACTIONS.find((reaction) => reaction.emoji === emoji)!
}

/** What a chip button says to a screen reader: the count, and what pressing does. */
export function chipLabel(summary: ReactionSummary): string {
  const { glyph } = reactionFor(summary.emoji)
  const options = { glyph, count: summary.count }
  return summary.reacted
    ? i18n.t('issues:comments.reactions.chipRemove', options)
    : i18n.t('issues:comments.reactions.chipAdd', options)
}

/** The tooltip: who, with "You" first when it is you. "You, Maya and Sam reacted with heart". */
export function whoReacted(summary: ReactionSummary, meId: number | undefined): string {
  // Ordered by id rather than by comparing names: "You" is the catalog's word
  // now, and somebody could be called it. `String()` because ListFormat
  // throws on a missing name where a join printed it, and a tooltip is not
  // worth a crash.
  const you = i18n.t('issues:comments.reactions.you')
  const ordered = [
    ...summary.users.filter((user) => user.id === meId).map(() => you),
    ...summary.users.filter((user) => user.id !== meId).map((user) => String(user.full_name)),
  ]
  return i18n.t('issues:comments.reactions.whoReacted', {
    names: formatList(ordered),
    name: reactionFor(summary.emoji).name,
    count: ordered.length,
  })
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
