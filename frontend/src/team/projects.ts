import type { ProjectRead } from '@/api/generated/models'

/**
 * The projects a picker should offer.
 *
 * Archived projects stay in the team's list -- issues still point at them and
 * need a name to show -- but nobody should be filing new work into one.
 * `keepId` is the same exception `activeMembers` makes: a filter or a rule
 * already set to an archived project has to keep showing it, or the dropdown
 * would render blank and the next save would quietly clear it.
 */
export function pickableProjects(
  projects: ProjectRead[],
  keepId?: number | null,
): ProjectRead[] {
  return projects.filter((project) => !project.archived || project.id === keepId)
}
