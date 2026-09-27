import { useQueryClient } from '@tanstack/react-query'

import {
  getListTicketsTeamsTeamIdTicketsGetQueryKey,
  useMoveTicketTicketsTicketIdMovePost,
} from '@/api/generated/endpoints/tickets/tickets'
import type { TicketRead, StatusRead, TeamRead } from '@/api/generated/models'
import { invalidateProjects } from '@/team/projects'

type TicketPage = { items: TicketRead[]; total: number; limit: number; offset: number }

/** Where a card was dropped: between two cards, maybe in another column. */
export type Placement = {
  aboveId: number | null
  belowId: number | null
  /** Set when the card also changed column. */
  status?: StatusRead
}

/**
 * The board's list with one card moved -- what the server is about to make
 * true, shown before it answers.
 *
 * The list is in board order, and every column shows its own cards in that
 * order, so placing the card next to its new neighbours in the one list puts
 * it in the right place in its column.
 */
export function placeTicket(
  items: TicketRead[],
  ticketId: number,
  { aboveId, belowId, status }: Placement,
): TicketRead[] {
  const moving = items.find((ticket) => ticket.id === ticketId)
  if (!moving) return items
  const moved = status ? { ...moving, status } : moving
  const rest = items.filter((ticket) => ticket.id !== ticketId)
  let at = 0
  if (belowId !== null && rest.some((ticket) => ticket.id === belowId)) {
    at = rest.findIndex((ticket) => ticket.id === belowId)
  } else if (aboveId !== null && rest.some((ticket) => ticket.id === aboveId)) {
    at = rest.findIndex((ticket) => ticket.id === aboveId) + 1
  }
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

/**
 * Drop a card between two others (#88), optimistically: the board shows it
 * there at once, and puts it back if the server refuses.
 */
export function useMoveTicket(
  team: TeamRead | undefined,
  ticketsParams: Parameters<typeof getListTicketsTeamsTeamIdTicketsGetQueryKey>[1],
) {
  const queryClient = useQueryClient()
  const move = useMoveTicketTicketsTicketIdMovePost()

  return async (ticketId: number, placement: Placement) => {
    if (!team) return
    const queryKey = getListTicketsTeamsTeamIdTicketsGetQueryKey(team.id, ticketsParams)
    const previous = queryClient.getQueryData<TicketPage>(queryKey)
    queryClient.setQueryData<TicketPage>(queryKey, (old) =>
      old ? { ...old, items: placeTicket(old.items, ticketId, placement) } : old,
    )
    try {
      await move.mutateAsync({
        ticketId,
        data: {
          above_id: placement.aboveId,
          below_id: placement.belowId,
          status_id: placement.status?.id ?? null,
        },
      })
      queryClient.invalidateQueries({ queryKey: [`/tickets/${ticketId}`] })
      if (placement.status) {
        queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/estimates`] })
        queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/sprints`] })
        invalidateProjects(queryClient, team.id)
      }
    } catch {
      queryClient.setQueryData(queryKey, previous)
    }
  }
}
