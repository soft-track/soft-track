import { useLocation, useParams } from 'react-router-dom'

import BoardPage from '@/board/BoardPage'
import { TicketPage } from '@/tickets/TicketPage'
import { surfaceFor } from '@/tickets/surface'

/**
 * Everything under /:teamKey: the board, a project, a ticket.
 *
 * One element for all three routes, so going from the board to a ticket's
 * panel and back keeps the same BoardPage mounted -- React Router renders the
 * same element type in the same place, and React keeps it. A ticket arrived
 * at without asking for the panel is a page of its own (#112), with no board
 * mounted behind it at all.
 */
export default function TeamRoute() {
  const { ticketNumber } = useParams<{ ticketNumber?: string }>()
  const { state } = useLocation()
  if (ticketNumber && surfaceFor(state) === 'page') return <TicketPage />
  return <BoardPage />
}
