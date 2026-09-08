import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  useGetIssueIssuesIssueIdGet,
  useUpdateIssueIssuesIssueIdPatch,
} from '@/api/generated/endpoints/issues/issues'
import type { IssueRead, IssueUpdate } from '@/api/generated/models'
import { toggleTaskAtOffset } from '@/markdown/tasks'
import { activeMembers } from '@/team/members'
import { useTeamContext } from '@/team/TeamContext'

/**
 * Loading and editing one issue: the query, the patch, and the draft state
 * for the two fields that are edited inline rather than through a select.
 *
 * Every write goes through `patch`, which is the one place that knows which
 * queries an issue change invalidates. A section that wrote through its own
 * mutation would forget one of them.
 */
export function useIssueEditor(issueId: number) {
  const { team, members } = useTeamContext()
  const queryClient = useQueryClient()

  const issueQuery = useGetIssueIssuesIssueIdGet(issueId)
  const updateIssue = useUpdateIssueIssuesIssueIdPatch()
  const issue = issueQuery.data

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  // Re-seed the drafts whenever the server's copy changes -- on first load
  // and after every patch. Done during render, the way React documents for
  // state that depends on a prop, rather than in an effect: an effect would
  // commit one frame with the stale draft and then render again.
  const [seededFrom, setSeededFrom] = useState<IssueRead | undefined>(undefined)
  if (issue !== seededFrom) {
    setSeededFrom(issue)
    if (issue) {
      setTitle(issue.title)
      setDescription(issue.description ?? '')
    }
  }

  const patch = async (data: IssueUpdate) => {
    await updateIssue.mutateAsync({ issueId, data })
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/issues`] })
    queryClient.invalidateQueries({ queryKey: [`/issues/${issueId}`] })
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/estimates`] })
    // Cycle progress moves whenever an issue's status or cycle changes.
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/cycles`] })
  }

  const saveTitle = () => {
    if (issue && title.trim() && title !== issue.title) patch({ title: title.trim() })
  }

  /**
   * Toggling a checkbox in the rendered description edits the stored markdown
   * and saves it. The offset comes from the source position of the list item,
   * so nothing else in the description is touched -- see markdown/tasks.ts.
   */
  const toggleTask = async (offset: number) => {
    const next = toggleTaskAtOffset(issue?.description ?? '', offset)
    if (next === null) return
    setDescription(next)
    await patch({ description: next })
  }

  const currentLabelIds = new Set((issue?.labels ?? []).map((label) => label.id))
  const toggleLabel = (labelId: number) => {
    const next = currentLabelIds.has(labelId)
      ? [...currentLabelIds].filter((id) => id !== labelId)
      : [...currentLabelIds, labelId]
    patch({ label_ids: next })
  }

  return {
    issue,
    patch,
    title,
    setTitle,
    saveTitle,
    description,
    setDescription,
    toggleTask,
    currentLabelIds,
    toggleLabel,
    /** Members as mentionable people, for the markdown editors. */
    people: activeMembers(members),
  }
}
