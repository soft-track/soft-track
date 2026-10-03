/**
 * WIP limits on board columns (#270): where a column stands against its
 * limit, and what a card arriving in it would do.
 *
 * The count is the server's (`wip_count` in the team's estimates): the whole
 * stage, whatever the board is filtered to, and without sub-tickets where the
 * team does not count them.
 */
export type WipStanding = {
  count: number
  limit: number
  /** Below, at, or past the limit. */
  state: 'room' | 'full' | 'over'
  /** How far past it, when it is. */
  overBy: number
}

export function standing(
  limit: number | null | undefined,
  count: number | undefined,
): WipStanding | null {
  if (limit == null) return null
  const held = count ?? 0
  return {
    count: held,
    limit,
    state: held > limit ? 'over' : held === limit ? 'full' : 'room',
    overBy: Math.max(0, held - limit),
  }
}

/**
 * What one more card would do to a column: nothing worth saying, take it
 * over its limit (where the team only warns), or be refused (where the team
 * makes limits hard). A card that does not count -- a sub-ticket where the
 * team does not count them -- changes nothing.
 */
export function arrival(
  column: WipStanding | null,
  { counts, hard }: { counts: boolean; hard: boolean },
): { kind: 'over'; count: number; limit: number } | { kind: 'refused' } | null {
  if (!column || !counts || column.count + 1 <= column.limit) return null
  return hard ? { kind: 'refused' } : { kind: 'over', count: column.count + 1, limit: column.limit }
}
