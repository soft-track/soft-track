import type { TeamRead } from '@/api/generated/models'

/**
 * An archived team (#322) is read-only, and out of the way: the team switcher,
 * the pickers and the pages that choose a team to open leave it out. It is
 * still there -- `GET /teams` returns it, saying so, so that its board, its
 * settings and `ENG-42` keep opening by its key.
 */
export function isArchived(team: Pick<TeamRead, 'archived_at'> | undefined | null): boolean {
  return Boolean(team?.archived_at)
}

/** The teams to offer: every one that is not archived. */
export function activeTeams<T extends Pick<TeamRead, 'archived_at'>>(teams: T[]): T[] {
  return teams.filter((team) => !isArchived(team))
}

/**
 * What the team switcher lists: the teams in use, and the one open now even
 * if it is archived -- the switcher shows where you are, and an archived
 * team's board is still somewhere you can be.
 */
export function switchableTeams<T extends Pick<TeamRead, 'id' | 'archived_at'>>(
  teams: T[],
  currentId: number | undefined,
): T[] {
  return teams.filter((team) => !isArchived(team) || team.id === currentId)
}
