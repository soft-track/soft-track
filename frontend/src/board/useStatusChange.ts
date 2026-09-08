import { useQueryClient } from '@tanstack/react-query'

import {
  getListIssuesTeamsTeamIdIssuesGetQueryKey,
  useUpdateIssueIssuesIssueIdPatch,
} from '@/api/generated/endpoints/issues/issues'
import type { IssueRead, IssueStatus, TeamRead } from '@/api/generated/models'

/** The shape the list endpoint caches: a page, not a bare array. */
type IssuePage = { items: IssueRead[]; total: number; limit: number; offset: number }

/**
 * Move an issue between columns, optimistically.
 *
 * The card moves before the server answers, and moves back if the server
 * refuses. `issuesParams` has to match what the board is showing, because it
 * is part of the query key being patched.
 */
export function useStatusChange(
  team: TeamRead | undefined,
  issuesParams: Parameters<typeof getListIssuesTeamsTeamIdIssuesGetQueryKey>[1],
) {
  const queryClient = useQueryClient()
  const updateIssue = useUpdateIssueIssuesIssueIdPatch()

  return async (issueId: number, status: IssueStatus) => {
    if (!team) return
    const queryKey = getListIssuesTeamsTeamIdIssuesGetQueryKey(team.id, issuesParams)
    const previous = queryClient.getQueryData<IssuePage>(queryKey)
    queryClient.setQueryData<IssuePage>(queryKey, (old) =>
      old
        ? {
            ...old,
            items: old.items.map((issue) =>
              issue.id === issueId ? { ...issue, status } : issue,
            ),
          }
        : old,
    )
    try {
      await updateIssue.mutateAsync({ issueId, data: { status } })
      queryClient.invalidateQueries({ queryKey: [`/issues/${issueId}`] })
      // Moving a card moves its points between columns.
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/estimates`] })
      queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/cycles`] })
    } catch {
      queryClient.setQueryData(queryKey, previous)
    }
  }
}
