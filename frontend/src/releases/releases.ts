import type { QueryClient } from '@tanstack/react-query'

import type { ReleaseRead, ReleaseState } from '@/api/generated/models'
import { i18n } from '@/i18n'

/**
 * The releases a picker should offer (#272): not the archived ones, unless
 * `keepId` is one -- the release a ticket already ships in, or a filter
 * already set -- so the picker does not go blank and quietly clear it.
 */
export function pickableReleases(
  releases: readonly ReleaseRead[],
  keepId?: number | null,
): ReleaseRead[] {
  return releases.filter((release) => release.state !== 'archived' || release.id === keepId)
}

/**
 * The release that is coming next: the planned one due soonest, then the
 * planned one made first. What the Releases tab opens on.
 */
export function comingRelease(releases: readonly ReleaseRead[]): ReleaseRead | null {
  const planned = releases.filter((release) => release.state === 'planned')
  const sorted = [...planned].sort((a, b) => {
    if (a.target_date && b.target_date) return a.target_date.localeCompare(b.target_date)
    if (a.target_date) return -1
    if (b.target_date) return 1
    return a.id - b.id
  })
  return sorted[0] ?? null
}

/**
 * Where a release's unfinished tickets go by default when it is released:
 * the next planned one -- the soonest target date, then the one made first
 * -- that is not this one. Null when there is none.
 */
export function nextRelease(
  releases: readonly ReleaseRead[],
  current: ReleaseRead,
): ReleaseRead | null {
  return comingRelease(releases.filter((release) => release.id !== current.id))
}

/** How each state reads, and its colour. Labels are getters over the catalog. */
export const RELEASE_STATES: Array<{ id: ReleaseState; label: string; colour: string }> = [
  releaseState('planned', 'var(--color-brand-600)'),
  releaseState('released', 'var(--color-status-done)'),
  releaseState('archived', 'var(--color-neutral-400)'),
]

function releaseState(id: ReleaseState, colour: string) {
  return {
    id,
    colour,
    get label() {
      return i18n.t(`releases:states.${id}`)
    },
  }
}

export function releaseStateMeta(state: ReleaseState) {
  return RELEASE_STATES.find((candidate) => candidate.id === state) ?? RELEASE_STATES[0]
}

/** Done over everything not cancelled, from 0 to 1, in points where there are any. */
export function releaseRatio(release: ReleaseRead): number {
  const { points_total, points_done, tickets_total, tickets_done } = release.progress
  if (points_total > 0) return points_done / points_total
  return tickets_total === 0 ? 0 : tickets_done / tickets_total
}

/**
 * Refetch everything that shows a release's progress. It moves with any
 * write to a ticket -- its status, its fix version, its estimate -- so the
 * writes that refresh epic progress call this too.
 */
export function invalidateReleases(queryClient: QueryClient, teamId: number) {
  queryClient.invalidateQueries({ queryKey: [`/teams/${teamId}/releases`] })
  queryClient.invalidateQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/releases/'),
  })
}

/** A file name for downloaded release notes: `release-notes-1.4.0.md`. */
export function notesFileName(release: Pick<ReleaseRead, 'name'>): string {
  const safe = release.name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return `release-notes-${safe || 'release'}.md`
}
