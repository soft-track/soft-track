import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useContext, useEffect } from 'react'
import { createPortal } from 'react-dom'

import { useGetTicketTicketsTicketIdGet } from '@/api/generated/endpoints/tickets/tickets'
import { errorDetail } from '@/api/errors'
import { useTranslation } from '@/i18n'
import { aboutTicket, type TicketModalEntry } from '@/tickets/modals'
import { TicketLayerContext, TicketStackContext } from '@/tickets/stackContext'
import { TicketBodySkeleton, TicketDetailBody } from '@/tickets/TicketDetailBody'
import { isPlainClick, ticketPath, TicketSurfaceContext } from '@/tickets/surface'
import { TeamProvider } from '@/team/TeamContext'
import { useTeamContext } from '@/team/useTeamContext'
import { useTeamData } from '@/team/useTeamData'
import { useTeamByKey } from '@/team/useTeams'
import { Icon } from '@/ui/Icon'
import { useFocusTrap } from '@/ui/useFocusTrap'

const statusOf = (error: unknown) =>
  (error as { response?: { status?: number } } | null)?.response?.status

/** Not there, or not yours to read: asking again changes neither. */
const retryUnlessRefused = (failures: number, error: unknown) =>
  failures < 1 && statusOf(error) !== 403 && statusOf(error) !== 404

/**
 * A linked ticket in a modal over the one you are reading (#114): a
 * blocker, a sub-ticket or the parent, opened to answer a question about
 * the ticket underneath without leaving it.
 *
 * Its own chrome -- where it was opened from, the way out to its page, the
 * close button -- and the shared body, editable: ticking a blocker to Done
 * from here is the point. The ticket underneath is refreshed when it
 * closes, so the row it was opened from catches up.
 *
 * TicketStack renders one per open modal and owns its keys; see there.
 */
export function TicketModal({
  entry,
  trail,
  beneath,
  onClose,
}: {
  entry: TicketModalEntry
  /** The identifiers of the tickets under this one, bottom first; undefined while one loads. */
  trail: ReadonlyArray<string | undefined>
  /** The ticket directly under this one, whose rows show what changes here. */
  beneath: number | undefined
  onClose: () => void
}) {
  const { t } = useTranslation(['tickets', 'common'])
  const stack = useContext(TicketStackContext)
  const depth = useContext(TicketLayerContext)
  // Beside the panel, or to the right of a page; see `.ticket-modal-scrim` in index.css.
  const surface = useContext(TicketSurfaceContext)
  const queryClient = useQueryClient()
  // Back to the row it was opened from, which Safari would not have focused.
  const dialogRef = useFocusTrap<HTMLDivElement>(() => stack?.openerOf(depth) ?? null)
  // The body reads the same query; React Query makes it one request.
  const { data: ticket, error } = useGetTicketTicketsTicketIdGet(entry.id, {
    query: { retry: retryUnlessRefused },
  })

  // However it closes -- Escape, the close button, Back -- the ticket
  // underneath catches up with whatever was changed up here.
  useEffect(() => {
    if (beneath === undefined) return
    return () => {
      const refresh = () => queryClient.invalidateQueries({ predicate: aboutTicket(beneath) })
      void refresh()
      // A change still on its way when the modal closed -- Done picked, then
      // Escape straight away -- lands after that, so again once it has.
      if (queryClient.isMutating() === 0) return
      const unsubscribe = queryClient.getMutationCache().subscribe(() => {
        if (queryClient.isMutating() > 0) return
        unsubscribe()
        void refresh()
      })
    }
  }, [queryClient, beneath])

  const shown = ticket ?? entry
  const from = trail.map((identifier) => identifier ?? '…')
  const openPage = () => stack?.openPage(shown)

  return createPortal(
    <div
      className="scrim ticket-modal-scrim fixed inset-0 z-30"
      data-over={surface}
      data-ticket-modal={depth}
      onClick={(event) => {
        // A portal moves the DOM, not the React tree: stop here, or the click
        // carries on through the ticket underneath, to the panel's backdrop.
        event.stopPropagation()
        onClose()
      }}
    >
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        tabIndex={-1}
        aria-label={ticket ? `${ticket.identifier} ${ticket.title}` : entry.identifier}
        data-ticket-layer={depth}
        onClick={(event) => event.stopPropagation()}
        className="ticket-modal pop-in glass-menu flex flex-col overflow-hidden rounded-panel"
      >
        <div className="hairline flex items-center justify-between gap-3 border-b px-4 py-3">
          <span className="flex min-w-0 items-center gap-2">
            {/* What it was opened over, so two scrims deep the stack still
                reads; pressing it goes back there. */}
            <button
              type="button"
              onClick={onClose}
              title={t('modal.backTo', { identifier: from[from.length - 1] })}
              className="ticket-modal-from flex min-w-0 items-center gap-1 rounded-full py-0.5 pl-1.5 pr-2 text-xs font-semibold transition"
            >
              <Icon name="arrow-left" size={12} className="shrink-0" />
              <span className="truncate">
                {from.length === 1
                  ? t('modal.from', { identifier: from[0] })
                  : from.join(t('modal.trailSeparator'))}
              </span>
            </button>
            {ticket && (
              <span
                className="dot"
                style={{ ['--dot' as string]: ticket.status.color }}
                title={ticket.status.name}
              />
            )}
            <span className="identifier shrink-0 text-xs font-semibold text-neutral-500">
              {shown.identifier}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {/* A link to the page, as on the panel: a middle click opens it
                in a new tab and leaves this where it is. */}
            <a
              href={ticketPath(shown)}
              onClick={(event) => {
                if (!isPlainClick(event)) return
                event.preventDefault()
                openPage()
              }}
              className="btn btn-ghost btn-sm text-neutral-500"
              aria-label={t('panel.openAsPage')}
              title={t('panel.openAsPage')}
            >
              <span className="hidden sm:inline">{t('panel.openAsPage')}</span>
              <Icon name="external" size={14} />
            </a>
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

        <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
          {error ? (
            <p className="px-6 py-12 text-center text-sm text-neutral-500">
              {statusOf(error) === 404
                ? t('page.notFoundBody', { identifier: entry.identifier })
                : statusOf(error) === 403
                  ? t('modal.notOnTeam', { identifier: entry.identifier })
                  : errorDetail(error, t('page.loadFailed'))}
            </p>
          ) : (
            <ItsTeam teamKey={shown.team_key}>
              <TicketDetailBody ticketId={entry.id} />
            </ItsTeam>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * The team a modal's ticket is read against. Usually the same as the ticket
 * underneath; but a link can cross teams (links.py), and then the statuses,
 * labels and people it offers have to be the other team's.
 */
function ItsTeam({ teamKey, children }: { teamKey: string; children: ReactNode }) {
  const here = useTeamContext()
  const same = here.team.key.toLowerCase() === teamKey.toLowerCase()
  const { team, teams } = useTeamByKey(same ? undefined : teamKey)
  const teamData = useTeamData(same ? undefined : team, { estimates: false })

  if (same) return children
  // Your teams are still loading. A team that is not among them never
  // arrives, but by then reading the ticket has been refused and said so.
  if (!team) return <TicketBodySkeleton />
  return <TeamProvider value={{ team, teams, ...teamData }}>{children}</TeamProvider>
}
