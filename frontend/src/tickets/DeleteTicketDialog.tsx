import { useId, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  useDeleteTicketTicketsTicketIdDelete,
  useListTicketLinksTicketsTicketIdLinksGet,
} from '@/api/generated/endpoints/tickets/tickets'
import { TicketTypeIcon } from '@/tickets/TicketTypeIcon'
import { errorDetail } from '@/api/errors'
import type { TicketRead } from '@/api/generated/models'
import { useTranslation } from '@/i18n'
import { aboutTicket } from '@/tickets/modals'
import { useFocusTrap } from '@/ui/useFocusTrap'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/ui/Icon'

export function DeleteTicketDialog({
  ticket,
  onDeleted,
  onClose,
}: {
  ticket: TicketRead
  onDeleted: () => void
  onClose: () => void
}) {
  const { t } = useTranslation('tickets')
  const queryClient = useQueryClient()
  const dialogRef = useFocusTrap<HTMLFormElement>()
  const titleId = useId()
  const links = useListTicketLinksTicketsTicketIdLinksGet(ticket.id)
  const remove = useDeleteTicketTicketsTicketIdDelete()
  const [error, setError] = useState<string | null>(null)
  const linkCount = links.data
    ? Object.values(links.data).reduce((total, items) => total + (items?.length ?? 0), 0)
    : 0

  const submit = async () => {
    if (remove.isPending) return
    setError(null)
    try {
      await remove.mutateAsync({ ticketId: ticket.id })
      await queryClient.invalidateQueries({ queryKey: [`/teams/${ticket.team_id}/tickets`] })
      await queryClient.invalidateQueries({ predicate: aboutTicket(ticket.id) })
      window.dispatchEvent(
        new CustomEvent('softtrack:toast', {
          detail: `${ticket.identifier} deleted${
            ticket.child_count > 0
              ? ` · ${ticket.child_count} sub-tickets moved to top level`
              : ''
          }`,
        }),
      )
      onDeleted()
    } catch (err: unknown) {
      setError(errorDetail(err, t('panel.delete.failed')))
    }
  }

  return createPortal(
    <div className="scrim fixed inset-0 z-30 flex items-center justify-center p-4" onClick={onClose}>
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !remove.isPending) {
            event.stopPropagation()
            onClose()
          }
        }}
        className="glass-strong w-full max-w-md rounded-panel p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-base font-semibold text-neutral-900">
          {t('panel.delete.title', {identifier: ticket.identifier,})}
        </h2>

        <div className="mt-4 flex items-center gap-2 rounded-control bg-neutral-100 px-3 py-2.5">
          <TicketTypeIcon type={ticket.type} size={13} />
          <span className="text-sm font-medium text-neutral-900">
            {ticket.identifier}
          </span>
          <span className="text-neutral-400">·</span>
          <span className="text-sm text-neutral-700">{ticket.title}</span>
        </div>

        <p className="mt-3 text-sm text-neutral-600">{t('panel.delete.removes')}</p>
        <ul className="mt-3 space-y-1 text-sm text-neutral-600">
          {ticket.child_count > 0 && (
            <li>{t('panel.delete.subTickets', { count: ticket.child_count })}</li>
          )}
          {linkCount > 0 && (
            <li>{t('panel.delete.links', { count: linkCount })}</li>
          )}
        </ul>
        <p className="mt-3 text-sm text-neutral-600">{t('panel.delete.promotes')}</p>
        {error && (
          <p role="alert" className="mt-3 rounded-control bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {error}
          </p>
        )}

        
        <div className="mt-5 flex justify-end gap-2 border-t border-neutral-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={remove.isPending}
            className="btn btn-secondary btn-sm"
          >
            {t('panel.delete.cancel')}
          </button>

          <button
            type="submit"
            disabled={remove.isPending}
            className="btn btn-danger btn-sm inline-flex items-center justify-center gap-2"
          >
            <Icon
              name="trash"
              size={15}
              strokeWidth={1.8}
              className="shrink-0 text-white"
            />
            {remove.isPending ? t('panel.delete.deleting') : t('panel.delete.confirm')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
