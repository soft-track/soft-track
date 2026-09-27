import { useListSprintsTeamsTeamIdSprintsGet } from '@/api/generated/endpoints/sprints/sprints'
import { useGetEstimateSummaryTeamsTeamIdEstimatesGet } from '@/api/generated/endpoints/tickets/tickets'
import { useListLabelsTeamsTeamIdLabelsGet } from '@/api/generated/endpoints/labels/labels'
import { useListProjectsTeamsTeamIdProjectsGet } from '@/api/generated/endpoints/projects/projects'
import { useListStatusesTeamsTeamIdStatusesGet } from '@/api/generated/endpoints/statuses/statuses'
import { useListTeamMembersTeamsTeamIdMembersGet } from '@/api/generated/endpoints/teams/teams'
import type { TeamRead } from '@/api/generated/models'

/**
 * Everything the board needs to know about a team besides its tickets.
 *
 * Six queries that used to sit inline at the top of the board page. They
 * are all enabled together, all keyed on the team, and all consumed through
 * TeamContext, so they belong together.
 */
export function useTeamData(
  team: TeamRead | undefined,
  /** Off for a ticket's page (#112), which has no columns to total. */
  { estimates: withEstimates = true }: { estimates?: boolean } = {},
) {
  const id = team?.id ?? 0
  const options = { query: { enabled: Boolean(team) } }

  const projects = useListProjectsTeamsTeamIdProjectsGet(id, options)
  const labels = useListLabelsTeamsTeamIdLabelsGet(id, options)
  const members = useListTeamMembersTeamsTeamIdMembersGet(id, options)
  const sprints = useListSprintsTeamsTeamIdSprintsGet(id, options)
  // The team's board columns. Everything that renders a status reads these
  // rather than a fixed list -- see issue #22.
  const statuses = useListStatusesTeamsTeamIdStatusesGet(id, options)
  // Rolled up on the server rather than summed from the ticket list: that
  // list is one page, so a client-side total would be the total of whatever
  // happened to be loaded.
  const estimates = useGetEstimateSummaryTeamsTeamIdEstimatesGet(id, {
    query: { enabled: Boolean(team) && withEstimates },
  })

  return {
    projects: projects.data ?? [],
    labels: labels.data ?? [],
    members: members.data ?? [],
    sprints: sprints.data ?? [],
    statuses: statuses.data ?? [],
    estimates: estimates.data,
  }
}
