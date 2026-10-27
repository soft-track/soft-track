import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import type { TeamRead, UserMe } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import type { Command } from '@/keyboard/CommandPalette'
import { activeTeams } from '@/team/archived'

export const BOARD_VIEWS = [
  'board',
  'list',
  'calendar',
  'roadmap',
  'reports',
  'plan',
  'releases',
] as const
export type BoardView = (typeof BOARD_VIEWS)[number]

/** What the command palette can do from the board, beyond jumping to tickets --
 *  and from My work (#258), which has no board views to switch between. */
export function useCommands({
  view,
  setView,
  team,
  teams,
  user,
  openNewTicket,
  openNewProject,
  openShortcuts,
}: {
  /** Absent off the board, and so is switching between board and list. */
  view?: BoardView
  setView?: (view: BoardView) => void
  team: TeamRead | undefined
  teams: TeamRead[]
  user: UserMe | null
  /** Absent for a guest (#104), who has nothing to create. */
  openNewTicket?: () => void
  /** Absent for a guest, the same way. */
  openNewProject?: () => void
  openShortcuts: () => void
}): Command[] {
  const navigate = useNavigate()
  const { t } = useTranslation('keyboard')

  return useMemo(() => {
    const actions = t('commands.groups.actions')
    const account = t('commands.groups.account')
    const list: Command[] = [
      ...(openNewTicket
        ? [
            {
              id: 'new-ticket',
              label: t('commands.newTicket'),
              hint: 'C',
              group: actions,
              run: openNewTicket,
            },
          ]
        : []),
      ...(openNewProject
        ? [
            {
              id: 'new-project',
              label: t('commands.newProject'),
              group: actions,
              run: openNewProject,
            },
          ]
        : []),
      ...(view && setView
        ? [
            {
              id: 'toggle-view',
              label: view === 'board' ? t('commands.switchToList') : t('commands.switchToBoard'),
              group: actions,
              run: () => setView(view === 'board' ? 'list' : 'board'),
            },
          ]
        : []),
      // Everything that is mine, across every team (#258). Not offered on
      // the page itself.
      ...(view
        ? [
            {
              id: 'my-work',
              label: t('commands.myWork'),
              hint: 'M',
              group: actions,
              run: () => navigate('/my-work'),
            },
          ]
        : []),
      {
        id: 'shortcuts',
        label: t('commands.showShortcuts'),
        hint: '?',
        group: actions,
        run: openShortcuts,
      },
    ]

    // Switching team is the team switcher's, which leaves an archived team
    // out (#322).
    for (const candidate of activeTeams(teams)) {
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
    openNewTicket,
    openNewProject,
    openShortcuts,
    t,
  ])
}
