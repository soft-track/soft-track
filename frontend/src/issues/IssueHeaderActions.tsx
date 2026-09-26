import { useState } from 'react'

import type { IssueRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { IssueActionsMenu } from '@/issues/detail/IssueActionsMenu'
import { MoveIssueModal } from '@/issues/MoveIssueModal'
import { WatchToggle } from '@/notifications/WatchToggle'
import { useCanWrite } from '@/team/useCanWrite'
import { useTeamContext } from '@/team/useTeamContext'

/**
 * Watch and the ⋯ menu: the actions every issue surface's header carries,
 * whatever else it adds around them -- a close button on the panel, a
 * permalink on the page (#112).
 */
export function IssueHeaderActions({ issue }: { issue: IssueRead }) {
  const { t } = useTranslation('issues')
  const { teams } = useTeamContext()
  // A guest (#104) sees the whole issue and can change none of it -- except
  // whether they are watching it, which is theirs.
  const readOnly = !useCanWrite()
  const [moving, setMoving] = useState(false)
  // Teams it could go to. Whether the user may write to each is the server's
  // call, and the move dialog says so if not.
  const elsewhere = teams.filter((team) => team.id !== issue.team_id)

  return (
    <>
      <WatchToggle issueId={issue.id} />
      {!readOnly && (
        <IssueActionsMenu
          actions={
            elsewhere.length > 0
              ? [{ label: t('panel.actions.moveToTeam'), onSelect: () => setMoving(true) }]
              : []
          }
        />
      )}
      {moving && (
        <MoveIssueModal issue={issue} teams={elsewhere} onClose={() => setMoving(false)} />
      )}
    </>
  )
}
