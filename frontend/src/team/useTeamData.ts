import { useListCyclesTeamsTeamIdCyclesGet } from '@/api/generated/endpoints/cycles/cycles'
import { useGetEstimateSummaryTeamsTeamIdEstimatesGet } from '@/api/generated/endpoints/issues/issues'
import { useListLabelsTeamsTeamIdLabelsGet } from '@/api/generated/endpoints/labels/labels'
import { useListProjectsTeamsTeamIdProjectsGet } from '@/api/generated/endpoints/projects/projects'
import { useListTeamMembersTeamsTeamIdMembersGet } from '@/api/generated/endpoints/teams/teams'
import type { TeamRead } from '@/api/generated/models'

/**
 * Everything the board needs to know about a team besides its issues.
 *
 * Five queries that used to sit inline at the top of the board page. They
 * are all enabled together, all keyed on the team, and all consumed through
 * TeamContext, so they belong together.
 */
export function useTeamData(team: TeamRead | undefined) {
  const id = team?.id ?? 0
  const options = { query: { enabled: Boolean(team) } }

  const projects = useListProjectsTeamsTeamIdProjectsGet(id, options)
  const labels = useListLabelsTeamsTeamIdLabelsGet(id, options)
  const members = useListTeamMembersTeamsTeamIdMembersGet(id, options)
  const cycles = useListCyclesTeamsTeamIdCyclesGet(id, options)
  // Rolled up on the server rather than summed from the issue list: that
  // list is one page, so a client-side total would be the total of whatever
  // happened to be loaded.
  const estimates = useGetEstimateSummaryTeamsTeamIdEstimatesGet(id, options)

  return {
    projects: projects.data ?? [],
    labels: labels.data ?? [],
    members: members.data ?? [],
    cycles: cycles.data ?? [],
    estimates: estimates.data,
  }
}
