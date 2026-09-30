import { Navigate } from 'react-router-dom'

import { NoTeamHome } from '@/team/NoTeamHome'
import { useMyTeams } from '@/team/useTeams'
import { Loading } from '@/ui/Loading'

/**
 * Landing route for authenticated users: their first team's board.
 *
 * With no team it is a page of its own (#318): what there is to reach without
 * one, the teams there are and who runs them, invitations when there are any,
 * and creating a team as one option. It used to go straight to "name your
 * team", which is the wrong first suggestion for nearly everybody who lands
 * here -- somebody invited, a new hire waiting to be added, or somebody in
 * finance or HR who has no reason to be on a delivery team at all.
 */
export default function TeamsHome() {
  const { data: teams, isLoading } = useMyTeams()

  if (isLoading) {
    return (
      <div className="h-screen">
        <Loading />
      </div>
    )
  }

  if (teams && teams.length > 0) {
    return <Navigate to={`/${teams[0].key}`} replace />
  }

  return <NoTeamHome />
}
