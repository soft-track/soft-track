import type { QueryClient } from '@tanstack/react-query'

import { getSearchSearchGetQueryKey } from '@/api/generated/endpoints/search/search'
import { getListTrashTeamsTeamIdTrashGetQueryKey } from '@/api/generated/endpoints/trash/trash'
import { MY_WORK_KEY } from '@/mywork/useMyWork'
import { invalidateReleases } from '@/releases/releases'
import { invalidateProjects } from '@/team/projects'

/**
 * Refetch what a write to a team's tickets can change: every filtered page
 * of its list (a parent's sub-tickets among them), its rollups, and every
 * open ticket -- the ones written, and those that link to them or are their
 * parents.
 */
export function invalidateTicketWrites(queryClient: QueryClient, teamId: number) {
  // Prefixes: every filtered page of the list, and every open ticket.
  queryClient.invalidateQueries({ queryKey: [`/teams/${teamId}/tickets`] })
  queryClient.invalidateQueries({ queryKey: [`/teams/${teamId}/estimates`] })
  queryClient.invalidateQueries({ queryKey: [`/teams/${teamId}/sprints`] })
  invalidateProjects(queryClient, teamId)
  invalidateReleases(queryClient, teamId)
  queryClient.invalidateQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/tickets/'),
  })
}

/**
 * Refetch after tickets move to the trash (#323): everything above, and the
 * places a trashed ticket leaves that are not the team's own -- My work and
 * search -- and the trash it lands in.
 */
export function invalidateTrashedTickets(queryClient: QueryClient, teamId: number) {
  invalidateTicketWrites(queryClient, teamId)
  queryClient.invalidateQueries({ queryKey: [MY_WORK_KEY] })
  queryClient.invalidateQueries({ queryKey: getSearchSearchGetQueryKey() })
  queryClient.invalidateQueries({ queryKey: getListTrashTeamsTeamIdTrashGetQueryKey(teamId) })
}
