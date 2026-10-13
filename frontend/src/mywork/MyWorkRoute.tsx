import PeopleLayout from '@/people/PeopleLayout'
import { activeTeams } from '@/team/archived'
import { NoTeamHome } from '@/team/NoTeamHome'
import { useMyTeams } from '@/team/useTeams'
import { Loading } from '@/ui/Loading'

/**
 * The frame around My work (#258): the sidebar of the team last open, as
 * beside the people pages, so its board is one click away.
 *
 * On no team there is no work to list and no sidebar to show, and the page
 * is the one for somebody on none (#318): invitations, the teams there are to
 * ask to join, and People, the profile and expenses.
 */
export default function MyWorkRoute() {
  const { data: teams, isLoading } = useMyTeams()

  if (isLoading) {
    return (
      <div className="h-screen">
        <Loading />
      </div>
    )
  }
  // Archived teams (#322) give it no sidebar to show.
  if (!teams || activeTeams(teams).length === 0) return <NoTeamHome />
  return <PeopleLayout />
}
