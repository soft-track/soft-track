import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { errorDetail } from '@/api/errors'
import {
  useBulkDeleteTicketsTeamsTeamIdTicketsBulkDeletePost,
  useBulkUpdateTicketsTeamsTeamIdTicketsBulkUpdatePost,
} from '@/api/generated/endpoints/tickets/tickets'
import type { TicketBulkChanges, TeamRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { invalidateProjects } from '@/team/projects'

/**
 * Change or delete many tickets in one request.
 *
 * One call for the batch rather than one per ticket, and the server applies it
 * all-or-nothing -- so there is no partial state to reconcile here, and a
 * failure leaves the board exactly as it was. That is also why this refetches
 * rather than patching the cache optimistically: with one request there is
 * nothing to hide the latency of, and a rule the server ran on the way may
 * have changed more than the payload said.
 */
export function useBulkEdit(team: TeamRead | undefined) {
  const { t } = useTranslation(['board', 'common'])
  const queryClient = useQueryClient()
  const bulkUpdate = useBulkUpdateTicketsTeamsTeamIdTicketsBulkUpdatePost()
  const bulkDelete = useBulkDeleteTicketsTeamsTeamIdTicketsBulkDeletePost()
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!team) return
    // Prefixes: every filtered page of the list, and every open ticket.
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/tickets`] })
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/estimates`] })
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/sprints`] })
    invalidateProjects(queryClient, team.id)
    queryClient.invalidateQueries({
      predicate: (query) =>
        typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/tickets/'),
    })
  }, [queryClient, team])

  const update = useCallback(
    async (ticketIds: readonly number[], changes: TicketBulkChanges): Promise<boolean> => {
      if (!team || ticketIds.length === 0) return false
      setError(null)
      try {
        await bulkUpdate.mutateAsync({
          teamId: team.id,
          data: { ticket_ids: [...ticketIds], changes },
        })
        return true
      } catch (err: unknown) {
        setError(errorDetail(err, t('bulk.errors.update')))
        return false
      } finally {
        refresh()
      }
    },
    [bulkUpdate, refresh, t, team],
  )

  const remove = useCallback(
    async (ticketIds: readonly number[]): Promise<boolean> => {
      if (!team || ticketIds.length === 0) return false
      setError(null)
      try {
        await bulkDelete.mutateAsync({ teamId: team.id, data: { ticket_ids: [...ticketIds] } })
        return true
      } catch (err: unknown) {
        setError(errorDetail(err, t('bulk.errors.delete')))
        return false
      } finally {
        refresh()
      }
    },
    [bulkDelete, refresh, t, team],
  )

  return {
    update,
    remove,
    isPending: bulkUpdate.isPending || bulkDelete.isPending,
    error,
    clearError: useCallback(() => setError(null), []),
  }
}

export type BulkEdit = ReturnType<typeof useBulkEdit>
