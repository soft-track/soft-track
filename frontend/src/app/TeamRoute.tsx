import { useLocation, useParams } from 'react-router-dom'

import BoardPage from '@/board/BoardPage'
import { IssuePage } from '@/issues/IssuePage'
import { surfaceFor } from '@/issues/surface'

/**
 * Everything under /:teamKey: the board, a project, an issue.
 *
 * One element for all three routes, so going from the board to an issue's
 * panel and back keeps the same BoardPage mounted -- React Router renders the
 * same element type in the same place, and React keeps it. An issue arrived
 * at without asking for the panel is a page of its own (#112), with no board
 * mounted behind it at all.
 */
export default function TeamRoute() {
  const { issueNumber } = useParams<{ issueNumber?: string }>()
  const { state } = useLocation()
  if (issueNumber && surfaceFor(state) === 'page') return <IssuePage />
  return <BoardPage />
}
