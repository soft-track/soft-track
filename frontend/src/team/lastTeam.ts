/**
 * The team whose board was open last, for pages that belong to no team (#125).
 *
 * The people directory sits in the same sidebar as a board, and the sidebar
 * is always some team's: its views, sprints and epics. Opening People from
 * the OPS board should keep OPS beside it rather than jump to whichever team
 * happens to be first. Per browser, and only a convenience -- storage that is
 * blocked or cleared just means the first team again.
 */
const KEY = 'softtrack.team'

export function rememberTeam(key: string): void {
  try {
    localStorage.setItem(KEY, key)
  } catch {
    // Private mode or blocked storage: the first team will do.
  }
}

export function lastTeamKey(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined
  } catch {
    return undefined
  }
}
