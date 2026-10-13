import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  useGetTicketTicketsTicketIdGet,
  useUpdateTicketTicketsTicketIdPatch,
} from '@/api/generated/endpoints/tickets/tickets'
import type { TicketRead, TicketUpdate } from '@/api/generated/models'
import { toggleTaskAtOffset } from '@/markdown/tasks'
import { activeMembers } from '@/team/members'
import { invalidateProjects } from '@/team/projects'
import { useTeamContext } from '@/team/useTeamContext'

/**
 * Loading and editing one ticket: the query, the patch, and the draft state
 * for the two fields that are edited inline rather than through a select.
 *
 * Every write goes through `patch`, which is the one place that knows which
 * queries a ticket change invalidates. A section that wrote through its own
 * mutation would forget one of them.
 */
export function useTicketEditor(ticketId: number) {
  const { team, members } = useTeamContext()
  const queryClient = useQueryClient()

  const ticketQuery = useGetTicketTicketsTicketIdGet(ticketId)
  const updateTicket = useUpdateTicketTicketsTicketIdPatch()
  const ticket = ticketQuery.data

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  // Re-seed the drafts whenever the server's copy changes -- on first load
  // and after every patch. Done during render, the way React documents for
  // state that depends on a prop, rather than in an effect: an effect would
  // commit one frame with the stale draft and then render again.
  const [seededFrom, setSeededFrom] = useState<TicketRead | undefined>(undefined)
  if (ticket !== seededFrom) {
    setSeededFrom(ticket)
    if (ticket) {
      setTitle(ticket.title)
      setDescription(ticket.description ?? '')
    }
  }

  const patch = async (data: TicketUpdate) => {
    await updateTicket.mutateAsync({ ticketId, data })
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/tickets`] })
    queryClient.invalidateQueries({ queryKey: [`/tickets/${ticketId}`] })
    // The change just made belongs in the Activity feed below.
    queryClient.invalidateQueries({ queryKey: [`/tickets/${ticketId}/events`] })
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/estimates`] })
    // Sprint progress moves whenever a ticket's status or sprint changes.
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/sprints`] })
    // And project progress whenever its status or project does.
    invalidateProjects(queryClient, team.id)
  }

  const saveTitle = () => {
    if (ticket && title.trim() && title !== ticket.title) patch({ title: title.trim() })
  }

  /**
   * Toggling a checkbox in the rendered description edits the stored markdown
   * and saves it. The offset comes from the source position of the list item,
   * so nothing else in the description is touched -- see markdown/tasks.ts.
   */
  const toggleTask = async (offset: number) => {
    const next = toggleTaskAtOffset(ticket?.description ?? '', offset)
    if (next === null) return
    setDescription(next)
    await patch({ description: next })
  }

  const currentLabelIds = new Set((ticket?.labels ?? []).map((label) => label.id))
  const toggleLabel = (labelId: number) => {
    const next = currentLabelIds.has(labelId)
      ? [...currentLabelIds].filter((id) => id !== labelId)
      : [...currentLabelIds, labelId]
    patch({ label_ids: next })
  }

  return {
    ticket,
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
