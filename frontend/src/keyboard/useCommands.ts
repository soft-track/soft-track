import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import type { TeamRead, UserMe } from '@/api/generated/models'
import type { Command } from '@/keyboard/CommandPalette'

export type BoardView = 'board' | 'list' | 'reports'

/** What the command palette can do from the board, beyond jumping to issues. */
export function useCommands({
  view,
  setView,
  team,
  teams,
  user,
  openNewIssue,
  openShortcuts,
}: {
  view: BoardView
  setView: (view: BoardView) => void
  team: TeamRead | undefined
  teams: TeamRead[]
  user: UserMe | null
  openNewIssue: () => void
  openShortcuts: () => void
}): Command[] {
  const navigate = useNavigate()

  return useMemo(() => {
    const list: Command[] = [
      { id: 'new-issue', label: 'Create an issue', hint: 'C', group: 'Actions', run: openNewIssue },
      {
        id: 'toggle-view',
        label: view === 'board' ? 'Switch to list view' : 'Switch to board view',
        group: 'Actions',
        run: () => setView(view === 'board' ? 'list' : 'board'),
      },
      {
        id: 'shortcuts',
        label: 'Show keyboard shortcuts',
        hint: '?',
        group: 'Actions',
        run: openShortcuts,
      },
    ]

    for (const candidate of teams) {
      if (candidate.id === team?.id) continue
      list.push({
        id: `team-${candidate.id}`,
        label: `Switch to ${candidate.name}`,
        hint: candidate.key,
        group: 'Teams',
        run: () => navigate(`/${candidate.key}`),
      })
    }

    list.push({
      id: 'settings',
      label: 'Open settings',
      group: 'Account',
      run: () => navigate('/settings/profile'),
    })
    if (team) {
      list.push({
        id: 'team-members',
        label: 'Manage team members',
        hint: team.key,
        group: 'Account',
        run: () => navigate(`/settings/teams/${team.key}/members`),
      })
    }
    if (user?.is_site_admin) {
      list.push({
        id: 'site-admin',
        label: 'Site administration',
        group: 'Account',
        run: () => navigate('/settings/admin/users'),
      })
    }

    return list
  }, [
    view,
    setView,
    teams,
    team,
    user?.is_site_admin,
    navigate,
    openNewIssue,
    openShortcuts,
  ])
}
