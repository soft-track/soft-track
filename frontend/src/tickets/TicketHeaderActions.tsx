import { useState } from 'react'

import type { TicketRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { TicketActionsMenu } from '@/tickets/detail/TicketActionsMenu'
import { MoveTicketModal } from '@/tickets/MoveTicketModal'
import { WatchToggle } from '@/notifications/WatchToggle'
import { useCanWrite } from '@/team/useCanWrite'
import { useTeamContext } from '@/team/useTeamContext'

/**
 * Watch and the ⋯ menu: the actions every ticket surface's header carries,
 * whatever else it adds around them -- a close button on the panel, a
 * permalink on the page (#112).
 */
export function TicketHeaderActions({ ticket }: { ticket: TicketRead }) {
  const { t } = useTranslation('tickets')
  const { teams } = useTeamContext()
  // A guest (#104) sees the whole ticket and can change none of it -- except
  // whether they are watching it, which is theirs.
  const readOnly = !useCanWrite()
  const [moving, setMoving] = useState(false)
  // Teams it could go to. Whether the user may write to each is the server's
  // call, and the move dialog says so if not.
  const elsewhere = teams.filter((team) => team.id !== ticket.team_id)

  return (
    <>
      <WatchToggle ticketId={ticket.id} />
      {!readOnly && (
        <TicketActionsMenu
          actions={
            elsewhere.length > 0
              ? [{ label: t('panel.actions.moveToTeam'), onSelect: () => setMoving(true) }]
              : []
          }
        />
      )}
      {moving && (
        <MoveTicketModal ticket={ticket} teams={elsewhere} onClose={() => setMoving(false)} />
      )}
    </>
  )
}
