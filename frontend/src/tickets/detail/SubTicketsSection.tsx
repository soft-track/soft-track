import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  useCreateTicketTeamsTeamIdTicketsPost,
  useListTicketsTeamsTeamIdTicketsGet,
  useUpdateTicketTicketsTicketIdPatch,
} from '@/api/generated/endpoints/tickets/tickets'
import type { TicketRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { useOpenRelatedTicket } from '@/tickets/surface'
import { useTeamContext } from '@/team/useTeamContext'
import { Icon } from '@/ui/Icon'

/**
 * The sub-tickets of one ticket, plus the breadcrumb when it is itself a child.
 *
 * Nesting is one level deep, so a ticket is either a parent or a child and
 * never both -- which is why this renders one or the other, never a tree.
 */
export function SubTicketsSection({
  ticket,
  readOnly = false,
}: {
  ticket: TicketRead
  /** A guest's view (#104): the sub-tickets, with no adding or ticking. */
  readOnly?: boolean
}) {
  const { t } = useTranslation(['tickets', 'common'])
  const { team, statuses } = useTeamContext()
  // On whichever surface this ticket is on: see tickets/surface.ts.
  const openTicket = useOpenRelatedTicket()
  const queryClient = useQueryClient()

  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')

  const createTicket = useCreateTicketTeamsTeamIdTicketsPost()
  const updateTicket = useUpdateTicketTicketsTicketIdPatch()

  const isChild = ticket.parent != null
  const childrenQuery = useListTicketsTeamsTeamIdTicketsGet(
    team.id,
    { parent_id: ticket.id, limit: 100 },
    { query: { enabled: !isChild } },
  )
  const children = childrenQuery.data?.items ?? []

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [`/teams/${team.id}/tickets`] })
    queryClient.invalidateQueries({ queryKey: [`/tickets/${ticket.id}`] })
  }

  const addChild = async () => {
    const trimmed = title.trim()
    if (!trimmed) return
    await createTicket.mutateAsync({
      teamId: team.id,
      data: { title: trimmed, parent_id: ticket.id },
    })
    setTitle('')
    setAdding(false)
    refresh()
  }

  // The checkbox means "finished", which is a category rather than a column.
  // A team may have several of either, so it ticks into the first `done` one
  // and unticks into the first that is not resolved -- the leftmost place the
  // work can plausibly go back to.
  const doneIn = statuses.find((status) => status.category === 'done')
  const reopenIn = statuses.find(
    (status) => status.category !== 'done' && status.category !== 'cancelled',
  )

  const toggleDone = async (child: TicketRead) => {
    const target = child.status.category === 'done' ? reopenIn : doneIn
    // A team that has deleted every done column has nowhere to tick to; the
    // checkbox is disabled below rather than sending a request that cannot
    // mean anything.
    if (!target) return
    await updateTicket.mutateAsync({
      ticketId: child.id,
      data: { status_id: target.id },
    })
    refresh()
  }

  if (isChild) {
    return (
      <button
        type="button"
        onClick={() => openTicket(ticket.parent!)}
        className="mb-2 flex max-w-full items-center gap-1.5 rounded-full bg-neutral-900/5 py-1 pl-2.5 pr-2 text-xs text-neutral-500 transition hover:bg-neutral-900/8 hover:text-neutral-900"
      >
        <span className="identifier font-medium">{ticket.parent!.identifier}</span>
        <span className="truncate">{ticket.parent!.title}</span>
        <Icon name="chevron-right" size={12} />
      </button>
    )
  }

  // With nothing to list and nothing to add, a guest would see a bare heading.
  if (readOnly && ticket.child_count === 0) return null

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="eyebrow">{t('subTickets.title')}</span>
          {ticket.child_count > 0 && (
            <span className="identifier text-[11px] text-neutral-400">
              {t('subTickets.progress', {
                done: ticket.completed_child_count,
                total: ticket.child_count,
              })}
            </span>
          )}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setAdding((open) => !open)}
            className="btn btn-ghost btn-xs"
          >
            {adding ? (
              t('common:cancel')
            ) : (
              <>
                <Icon name="plus" size={12} /> {t('common:add')}
              </>
            )}
          </button>
        )}
      </div>

      {ticket.child_count > 0 && (
        <div className="mb-2 h-1 overflow-hidden rounded-full bg-neutral-900/8">
          <div
            className="h-full rounded-full bg-linear-to-r from-brand-500 to-accent-sky transition-all"
            style={{
              width: `${(ticket.completed_child_count / ticket.child_count) * 100}%`,
            }}
          />
        </div>
      )}

      {adding && (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addChild()
            if (e.key === 'Escape') setAdding(false)
          }}
          onBlur={addChild}
          placeholder={t('subTickets.placeholder')}
          className="field field-sm mb-2"
        />
      )}

      {children.length > 0 && (
        <ul className="space-y-0.5">
          {children.map((child) => {
            const done = child.status.category === 'done'
            return (
              <li
                key={child.id}
                className="flex items-center gap-2 rounded-control px-2 py-1 transition hover:bg-neutral-900/4"
              >
                <input
                  type="checkbox"
                  checked={done}
                  onChange={() => toggleDone(child)}
                  disabled={readOnly || (done ? !reopenIn : !doneIn)}
                  aria-label={
                    done
                      ? t('subTickets.reopen', { identifier: child.identifier })
                      : t('subTickets.complete', { identifier: child.identifier })
                  }
                  className="h-3.5 w-3.5 shrink-0 rounded accent-brand-600"
                />
                <button
                  type="button"
                  onClick={() => openTicket(child)}
                  className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                >
                  <span className="identifier shrink-0 text-xs text-neutral-400">
                    {child.identifier}
                  </span>
                  <span
                    className={`truncate text-sm ${
                      done ? 'text-neutral-400 line-through' : 'text-neutral-800'
                    }`}
                  >
                    {child.title}
                  </span>
                </button>
                <span
                  className="dot"
                  style={{ ['--dot' as string]: child.status.color }}
                  title={child.status.name}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
