import { useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/useAuth'
import { toSearchParams } from '@/board/filters'
import { withGrouping } from '@/board/grouping'
import { Sidebar } from '@/board/Sidebar'
import { DEFAULT_SORT, withSort } from '@/board/sorting'
import { lastTeamKey } from '@/team/lastTeam'
import { ShellFrame } from '@/team/ShellFrame'
import { TeamProvider } from '@/team/TeamContext'
import { useTeamData } from '@/team/useTeamData'
import { useTeamByKey } from '@/team/useTeams'
import { Loading } from '@/ui/Loading'

/** What the people pages get from the frame around them. */
export type PeopleOutlet = {
  /** Opens the sidebar below `lg`; absent when there is no sidebar. */
  openSidebar?: () => void
}

/**
 * The frame around the people pages (#125): the same sidebar as the board.
 *
 * The directory is nobody's team, but the sidebar is always some team's, so
 * it is the team whose board was open last -- opening People from OPS keeps
 * OPS beside it. Its views, sprints and epics open that team's board.
 */
export default function PeopleLayout() {
  const [lastKey] = useState(lastTeamKey)
  const { team: remembered, teams, isLoading } = useTeamByKey(lastKey)
  const team = remembered ?? teams[0]
  const teamData = useTeamData(team)
  const { user } = useAuth()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)

  if (isLoading) {
    return (
      <div className="h-screen">
        <Loading />
      </div>
    )
  }

  // Somebody on no team yet still has colleagues to look up.
  if (!team) {
    return (
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-3 p-2 sm:p-3">
        <Outlet context={{} satisfies PeopleOutlet} />
      </div>
    )
  }

  const isTeamAdmin =
    teamData.members.find((member) => member.user.id === user?.id)?.role === 'admin'

  const sidebar = (
    <Sidebar
      filters={null}
      arrangement={{ grouping: 'status', sort: DEFAULT_SORT }}
      onFiltersChange={(filters, arrangement) => {
        setDrawerOpen(false)
        const search = withSort(
          withGrouping(toSearchParams(filters), arrangement?.grouping ?? 'status'),
          arrangement?.sort ?? DEFAULT_SORT,
        )
        navigate({ pathname: `/${team.key}`, search: search.toString() })
      }}
      isAdmin={isTeamAdmin}
    />
  )

  return (
    <TeamProvider value={{ team, teams, ...teamData }}>
      <ShellFrame
        sidebar={sidebar}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Outlet context={{ openSidebar: () => setDrawerOpen(true) } satisfies PeopleOutlet} />
        </div>
      </ShellFrame>
    </TeamProvider>
  )
}
