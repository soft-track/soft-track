import { useQueryClient } from '@tanstack/react-query'

import {
  getListIssuesTeamsTeamIdIssuesGetQueryKey,
  useMoveIssueIssuesIssueIdMovePost,
} from '@/api/generated/endpoints/issues/issues'
import type { IssueRead, StatusRead, TeamRead } from '@/api/generated/models'
import { invalidateProjects } from '@/team/projects'

type IssuePage = { items: IssueRead[]; total: number; limit: number; offset: number }

/** Where a card was dropped: between two cards, maybe in another column. */
export type Placement = {
  aboveId: number | null
  belowId: number | null
  /** Set when the card also changed column. */
  status?: StatusRead
}

/**
 * The board's list with one card moved -- what the server is about to make
 * true, shown before it answers.
 *
 * The list is in board order, and every column shows its own cards in that
 * order, so placing the card next to its new neighbours in the one list puts
 * it in the right place in its column.
 */
export function placeIssue(
  items: IssueRead[],
  issueId: number,
  { aboveId, belowId, status }: Placement,
): IssueRead[] {
  const moving = items.find((issue) => issue.id === issueId)
  if (!moving) return items
  const moved = status ? { ...moving, status } : moving
  const rest = items.filter((issue) => issue.id !== issueId)
  let at = 0
  if (belowId !== null && rest.some((issue) => issue.id === belowId)) {
    at = rest.findIndex((issue) => issue.id === belowId)
  } else if (aboveId !== null && rest.some((issue) => issue.id === aboveId)) {
    at = rest.findIndex((issue) => issue.id === aboveId) + 1
  }
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

/**
 * Drop a card between two others (#88), optimistically: the board shows it
 * there at once, and puts it back if the server refuses.
 */
export function useMoveIssue(
  team: TeamRead | undefined,
  issuesParams: Parameters<typeof getListIssuesTeamsTeamIdIssuesGetQueryKey>[1],
) {
  const queryClient = useQueryClient()
  const move = useMoveIssueIssuesIssueIdMovePost()

  return async (issueId: number, placement: Placement) => {
    if (!team) return
    const queryKey = getListIssuesTeamsTeamIdIssuesGetQueryKey(team.id, issuesParams)
    const previous = queryClient.getQueryData<IssuePage>(queryKey)
    queryClient.setQueryData<IssuePage>(queryKey, (old) =>
      old ? { ...old, items: placeIssue(old.items, issueId, placement) } : old,
    )
    try {
      await move.mutateAsync({
        issueId,
        data: {
          above_id: placement.aboveId,
          below_id: placement.belowId,
          status_id: placement.status?.id ?? null,
        },
      })
      queryClient.invalidateQueries({ queryKey: [`/issues/${issueId}`] })
      if (placement.status) {
        queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/estimates`] })
        queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/cycles`] })
        invalidateProjects(queryClient, team.id)
      }
    } catch {
      queryClient.setQueryData(queryKey, previous)
    }
  }
}
