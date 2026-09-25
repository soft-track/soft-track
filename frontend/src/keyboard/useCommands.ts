import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import type { TeamRead, UserMe } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import type { Command } from '@/keyboard/CommandPalette'

export type BoardView = 'board' | 'list' | 'calendar' | 'roadmap' | 'reports'

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
  /** Absent for a guest (#104), who has nothing to create. */
  openNewIssue?: () => void
  openShortcuts: () => void
}): Command[] {
  const navigate = useNavigate()
  const { t } = useTranslation('keyboard')

  return useMemo(() => {
    const actions = t('commands.groups.actions')
    const account = t('commands.groups.account')
    const list: Command[] = [
      ...(openNewIssue
        ? [
            {
              id: 'new-issue',
              label: t('commands.newIssue'),
              hint: 'C',
              group: actions,
              run: openNewIssue,
            },
          ]
        : []),
      {
        id: 'toggle-view',
        label: view === 'board' ? t('commands.switchToList') : t('commands.switchToBoard'),
        group: actions,
        run: () => setView(view === 'board' ? 'list' : 'board'),
      },
      {
        id: 'shortcuts',
        label: t('commands.showShortcuts'),
        hint: '?',
        group: actions,
        run: openShortcuts,
      },
    ]

    for (const candidate of teams) {
      if (candidate.id === team?.id) continue
      list.push({
        id: `team-${candidate.id}`,
        label: t('commands.switchTeam', { team: candidate.name }),
        hint: candidate.key,
        group: t('commands.groups.teams'),
        run: () => navigate(`/${candidate.key}`),
      })
    }

    list.push({
      id: 'settings',
      label: t('commands.openSettings'),
      group: account,
      run: () => navigate('/settings/profile'),
    })
    if (team) {
      list.push({
        id: 'team-members',
        label: t('commands.manageMembers'),
        hint: team.key,
        group: account,
        run: () => navigate(`/settings/teams/${team.key}/members`),
      })
    }
    if (user?.is_site_admin) {
      list.push({
        id: 'site-admin',
        label: t('commands.siteAdmin'),
        group: account,
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
    t,
  ])
}
