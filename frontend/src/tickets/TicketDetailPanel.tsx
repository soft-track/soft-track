import { useGetTicketTicketsTicketIdGet } from '@/api/generated/endpoints/tickets/tickets'
import { useTranslation } from '@/i18n'
import { TicketDetailBody } from '@/tickets/TicketDetailBody'
import { TicketHeaderActions } from '@/tickets/TicketHeaderActions'
import { TicketStack } from '@/tickets/TicketStack'
import {
  type TicketRef,
  TicketSurfaceContext,
  isPlainClick,
  ticketPath,
  useOpenTicket,
} from '@/tickets/surface'
import { Icon } from '@/ui/Icon'
import { useFocusTrap } from '@/ui/useFocusTrap'

/**
 * The slide-over for one ticket, over the board: a glance, not a place to
 * work (#112). Its own chrome -- the scrim, the close button, the way out to
 * the ticket's page -- and the shared body below it. A ticket the body links
 * to opens in a modal beside the panel (#114); the keys are that stack's.
 */
export function TicketDetailPanel({
  ticketId,
  onClose,
  openPage,
}: {
  ticketId: number
  onClose: () => void
  /**
   * Trade the glance for a ticket's own page: this one's, or one opened in a
   * modal over it. Straight there unless given; the board gives its own,
   * which first keeps its view and search for Back, as it does for the
   * command palette.
   */
  openPage?: (ticket: TicketRef) => void
}) {
  const { t } = useTranslation(['tickets', 'common'])
  const openTicket = useOpenTicket()
  const dialogRef = useFocusTrap<HTMLDivElement>()
  // The body reads the same query; React Query makes it one request.
  const { data: ticket } = useGetTicketTicketsTicketIdGet(ticketId)

  return (
    <TicketSurfaceContext.Provider value="panel">
      <div className="scrim fixed inset-0 z-20 flex justify-end" onClick={onClose}>
        <div
          role="dialog"
          ref={dialogRef}
          aria-modal="true"
          tabIndex={-1}
          aria-label={ticket ? `${ticket.identifier} ${ticket.title}` : t('panel.loading')}
          // The bottom of its stack; see TicketStack.
          data-ticket-layer={0}
          onClick={(e) => e.stopPropagation()}
          className="slide-in-right glass-strong m-2 flex w-full max-w-xl flex-col overflow-hidden rounded-panel sm:m-3"
        >
          <div className="hairline flex items-center justify-between gap-3 border-b px-4 py-3">
            <span className="flex min-w-0 items-center gap-2">
              {ticket && (
                <span
                  className="dot"
                  style={{ ['--dot' as string]: ticket.status.color }}
                  title={ticket.status.name}
                />
              )}
              <span className="identifier text-xs font-semibold text-neutral-500">
                {ticket ? ticket.identifier : '…'}
              </span>
              {ticket?.external_key && (
                <span
                  className="identifier rounded-full bg-neutral-900/6 px-2 py-0.5 text-[10px] text-neutral-500"
                  title={t('panel.importedKey')}
                >
                  {ticket.external_key}
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {ticket && <TicketHeaderActions ticket={ticket} />}
              {ticket && (
                // A link to the page it opens, so a middle click puts that
                // page in a new tab and leaves the panel where it is.
                <a
                  href={ticketPath(ticket)}
                  onClick={(e) => {
                    if (!isPlainClick(e)) return
                    e.preventDefault()
                    if (openPage) openPage(ticket)
                    else openTicket(ticket, 'page')
                  }}
                  className="btn btn-ghost btn-icon btn-sm text-neutral-500"
                  aria-label={t('panel.openAsPage')}
                  title={t('panel.openAsPage')}
                >
                  <Icon name="expand" size={14} />
                </a>
              )}
              <button
                type="button"
                onClick={onClose}
                className="btn btn-ghost btn-icon btn-sm text-neutral-500"
                aria-label={t('common:close')}
                title={t('panel.closeHint')}
              >
                <Icon name="close" size={15} />
              </button>
            </span>
          </div>

          <div className="scroll-thin flex flex-1 flex-col overflow-y-auto">
            <TicketStack ticket={ticket} onClose={onClose} openPage={openPage}>
              <TicketDetailBody ticketId={ticketId} />
            </TicketStack>
          </div>
        </div>
      </div>
    </TicketSurfaceContext.Provider>
  )
}
