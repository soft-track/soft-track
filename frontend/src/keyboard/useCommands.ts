import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import type { TeamRead } from '@/api/generated/models'
import type { Command } from '@/keyboard/CommandPalette'

export type BoardView = 'board' | 'list' | 'reports'

/** What the command palette can do from the board, beyond jumping to issues. */
export function useCommands({
  view,
  setView,
  team,
  teams,
  openNewIssue,
  openShortcuts,
}: {
  view: BoardView
  setView: (view: BoardView) => void
  team: TeamRead | undefined
  teams: TeamRead[]
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

    return list
  }, [view, setView, teams, team?.id, navigate, openNewIssue, openShortcuts])
}
