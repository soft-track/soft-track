import { useQueryClient } from '@tanstack/react-query'

import {
  getListTicketsTeamsTeamIdTicketsGetQueryKey,
  useUpdateTicketTicketsTicketIdPatch,
} from '@/api/generated/endpoints/tickets/tickets'
import type { TicketRead, StatusRead, TeamRead } from '@/api/generated/models'
import { invalidateProjects } from '@/team/projects'

/** The shape the list endpoint caches: a page, not a bare array. */
type TicketPage = { items: TicketRead[]; total: number; limit: number; offset: number }

/**
 * Move a ticket between columns, optimistically.
 *
 * The card moves before the server answers, and moves back if the server
 * refuses. `ticketsParams` has to match what the board is showing, because it
 * is part of the query key being patched.
 */
export function useStatusChange(
  team: TeamRead | undefined,
  ticketsParams: Parameters<typeof getListTicketsTeamsTeamIdTicketsGetQueryKey>[1],
) {
  const queryClient = useQueryClient()
  const updateTicket = useUpdateTicketTicketsTicketIdPatch()

  return async (ticketId: number, status: StatusRead) => {
    if (!team) return
    const queryKey = getListTicketsTeamsTeamIdTicketsGetQueryKey(team.id, ticketsParams)
    const previous = queryClient.getQueryData<TicketPage>(queryKey)
    queryClient.setQueryData<TicketPage>(queryKey, (old) =>
      old
        ? {
            ...old,
            items: old.items.map((ticket) =>
              ticket.id === ticketId ? { ...ticket, status } : ticket,
            ),
          }
        : old,
    )
    try {
      await updateTicket.mutateAsync({ ticketId, data: { status_id: status.id } })
      queryClient.invalidateQueries({ queryKey: [`/tickets/${ticketId}`] })
      // Moving a card moves its points between columns.
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/estimates`] })
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/sprints`] })
      invalidateProjects(queryClient, team.id)
    } catch {
      queryClient.setQueryData(queryKey, previous)
    }
  }
}
