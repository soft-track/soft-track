import { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import type { TicketRead } from '@/api/generated/models'
import { useTicketShortcuts } from '@/tickets/detail/useTicketShortcuts'
import { MAX_MODAL_DEPTH, modalsIn, type TicketModalEntry, withModal } from '@/tickets/modals'
import {
  type RelatedOpens,
  TicketLayerContext,
  TicketStackContext,
  type TicketStackValue,
} from '@/tickets/stackContext'
import { type TicketRef, useOpenTicket } from '@/tickets/surface'
import { TicketModal } from '@/tickets/TicketModal'
import { topDialog } from '@/ui/useFocusTrap'

/**
 * A ticket on the panel or on its page, and the linked tickets opened in
 * modals over it (#114): one stack, bottom first, of at most three. Following
 * a ticket from the top opens it over the rest, or its page from the deepest
 * modal, or -- when it is open beneath already -- goes back down to it.
 *
 * The keys belong to the stack rather than to each ticket in it: one
 * listener, so one Escape closes one thing -- the top modal, and the panel
 * only once there is none -- and S, P, A and L reach the fields of the
 * ticket on top. The board's overlay stack (board/overlays.ts) cannot hold
 * these: the same stack stands on a ticket's page, where there is no board,
 * and it has to live in the history for Back to close its top.
 *
 * Opening a modal pushes an entry at the same address; closing one, however
 * it closes, goes back one. See modals.ts.
 */
export function TicketStack({
  ticket,
  onClose,
  openPage,
  children,
}: {
  /** The ticket at the bottom, the panel's or the page's. Undefined while it loads. */
  ticket: TicketRead | undefined
  /** Escape with no modal open. The panel closes; a page has nothing to close. */
  onClose?: () => void
  /**
   * Leave for a ticket's page: a modal's own, or one followed from the
   * deepest modal. Straight there unless given; the board gives its own,
   * which keeps its view and search for Back.
   */
  openPage?: (ticket: TicketRef) => void
  /** The bottom ticket's chrome and body. */
  children: ReactNode
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const goTo = useOpenTicket()
  const modals = useMemo(() => modalsIn(location.state), [location.state])
  // The ticket on each layer, bottom first.
  const bottom = ticket?.id
  const layers = useMemo(() => [bottom, ...modals.map((modal) => modal.id)], [bottom, modals])
  // Who opened each modal, by depth: elements, so not in the history entry.
  // A modal come back to by Forward was opened by the last one set here.
  const openers = useRef<Array<HTMLElement | null>>([])

  // Going back is asynchronous in a browser: until it lands, this entry --
  // and the modal being closed -- is still what shows, and a second Escape
  // would go back past it, off a ticket page to wherever came before it.
  const leaving = useRef(false)
  useEffect(() => {
    leaving.current = false
  }, [location.key])
  const back = useCallback(
    (entries: number) => {
      if (leaving.current) return
      leaving.current = true
      navigate(-entries)
    },
    [navigate],
  )

  const leave = useCallback(
    (target: TicketRef) => (openPage ? openPage(target) : goTo(target, 'page')),
    [openPage, goTo],
  )

  const opens = useCallback(
    (from: number, id: number): RelatedOpens => {
      const beneath = layers.indexOf(id)
      if (beneath !== -1 && beneath < from) return 'back'
      return from < MAX_MODAL_DEPTH ? 'modal' : 'page'
    },
    [layers],
  )

  const open = useCallback(
    (from: number, target: TicketModalEntry, opener: HTMLElement | null) => {
      // Only from the top: everything under it is behind a scrim, and Back
      // closes one modal only while there is one entry per modal.
      if (from !== modals.length) return
      const opening = opens(from, target.id)
      // Down to it, as many modals as that takes: each is one entry.
      if (opening === 'back') back(from - layers.indexOf(target.id))
      else if (opening === 'page') leave(target)
      else {
        openers.current[from + 1] = opener
        navigate(
          { pathname: location.pathname, search: location.search, hash: location.hash },
          { state: withModal(location.state, target) },
        )
      }
    },
    [modals.length, opens, layers, back, leave, navigate, location],
  )

  // Each modal's entry was pushed over the one before, so one back is one
  // modal fewer, and Forward can open it again.
  const closeTop = useCallback(() => back(1), [back])

  // A dialog of another kind open over the stack -- the command palette, the
  // cheatsheet, moving a ticket -- has the keys: one Escape closes it and
  // nothing under it. Every layer's dialog says which layer it is.
  const covered = () => {
    const top = topDialog()
    return top !== null && !top.hasAttribute('data-ticket-layer')
  }
  useTicketShortcuts(
    () => {
      if (covered()) return
      if (modals.length > 0) closeTop()
      else onClose?.()
    },
    () => {
      if (covered()) return null
      if (modals.length === 0) return document
      return document.querySelector(`[data-ticket-layer="${modals.length}"]`)
    },
  )

  const stack = useMemo<TicketStackValue>(
    () => ({
      modals,
      open,
      opens,
      openPage: leave,
      openerOf: (depth) => openers.current[depth] ?? null,
    }),
    [modals, open, opens, leave],
  )

  return (
    <TicketStackContext.Provider value={stack}>
      <TicketLayerContext.Provider value={0}>{children}</TicketLayerContext.Provider>
      {modals.map((entry, index) => (
        <TicketLayerContext.Provider key={`${index}:${entry.id}`} value={index + 1}>
          <TicketModal
            entry={entry}
            trail={[ticket?.identifier, ...modals.slice(0, index).map((below) => below.identifier)]}
            beneath={index === 0 ? ticket?.id : modals[index - 1].id}
            onClose={closeTop}
          />
        </TicketLayerContext.Provider>
      ))}
    </TicketStackContext.Provider>
  )
}
