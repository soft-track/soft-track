import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { errorDetail } from '@/api/errors'
import {
  useBulkDeleteIssuesTeamsTeamIdIssuesBulkDeletePost,
  useBulkUpdateIssuesTeamsTeamIdIssuesBulkUpdatePost,
} from '@/api/generated/endpoints/issues/issues'
import type { IssueBulkChanges, TeamRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { invalidateProjects } from '@/team/projects'

/**
 * Change or delete many issues in one request.
 *
 * One call for the batch rather than one per issue, and the server applies it
 * all-or-nothing -- so there is no partial state to reconcile here, and a
 * failure leaves the board exactly as it was. That is also why this refetches
 * rather than patching the cache optimistically: with one request there is
 * nothing to hide the latency of, and a rule the server ran on the way may
 * have changed more than the payload said.
 */
export function useBulkEdit(team: TeamRead | undefined) {
  const { t } = useTranslation(['board', 'common'])
  const queryClient = useQueryClient()
  const bulkUpdate = useBulkUpdateIssuesTeamsTeamIdIssuesBulkUpdatePost()
  const bulkDelete = useBulkDeleteIssuesTeamsTeamIdIssuesBulkDeletePost()
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!team) return
    // Prefixes: every filtered page of the list, and every open issue.
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/issues`] })
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/estimates`] })
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/cycles`] })
    invalidateProjects(queryClient, team.id)
    queryClient.invalidateQueries({
      predicate: (query) =>
        typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/issues/'),
    })
  }, [queryClient, team])

  const update = useCallback(
    async (issueIds: readonly number[], changes: IssueBulkChanges): Promise<boolean> => {
      if (!team || issueIds.length === 0) return false
      setError(null)
      try {
        await bulkUpdate.mutateAsync({
          teamId: team.id,
          data: { issue_ids: [...issueIds], changes },
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
    async (issueIds: readonly number[]): Promise<boolean> => {
      if (!team || issueIds.length === 0) return false
      setError(null)
      try {
        await bulkDelete.mutateAsync({ teamId: team.id, data: { issue_ids: [...issueIds] } })
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
