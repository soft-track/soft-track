import { Navigate } from 'react-router-dom'

import { useMyTeams } from '../lib/useTeams'

/**
 * Landing route for authenticated users: redirect to their first team's
 * board, or to team creation if they don't belong to one yet.
 */
export default function TeamsHome() {
  const { data: teams, isLoading } = useMyTeams()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-neutral-400">
        Loading…
      </div>
    )
  }

  if (!teams || teams.length === 0) {
    return <Navigate to="/new-team" replace />
  }

  return <Navigate to={`/${teams[0].key}`} replace />
}
