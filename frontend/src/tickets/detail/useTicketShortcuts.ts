import { useEffect, useRef } from 'react'

import { isPlainKey, isTypingTarget } from '@/keyboard/typing'

/**
 * The keys that work while a ticket is open: S, P, A, L, and Escape when
 * there is something to close. The ticket's page (#112) has nothing to close
 * of its own, but a modal over it (#114) does.
 *
 * One listener for a whole stack of tickets -- the panel or the page, and
 * the modals over it -- rather than one per ticket, so that one Escape is
 * one decision: `onClose` is whatever is on top. And the letters look for
 * their field inside `scope`, the ticket on top, since the one underneath
 * has a Status field too, earlier in the document. A scope of null is a
 * ticket not drawn yet, with no fields to go to.
 *
 * The listener is registered once and reads the latest of both through refs.
 * Re-registering it on every render put it *after* the board's global
 * listener, whose Escape handling re-rendered the board mid-dispatch and
 * removed this listener before it could run.
 */
export function useTicketShortcuts(onClose?: () => void, scope?: () => ParentNode | null) {
  const latest = useRef({ onClose, scope })
  useEffect(() => {
    latest.current = { onClose, scope }
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Anything inside the ticket that consumes Escape (the mention menu,
        // a native select) stops propagation before this runs, so by the
        // time it reaches here the user does mean the ticket.
        latest.current.onClose?.()
        return
      }

      if (!isPlainKey(e) || isTypingTarget(e.target)) return

      // Focus the control rather than mutating anything: the value still gets
      // chosen deliberately, which is what keeps a stray keystroke from
      // silently reassigning someone's ticket.
      const field = { s: 'status', p: 'priority', a: 'assignee', l: 'labels' }[
        e.key.toLowerCase()
      ]
      if (!field) return

      const { scope } = latest.current
      const root = scope ? scope() : document
      const control = root?.querySelector<HTMLElement>(`[data-field="${field}"]`)
      if (!control) return
      e.preventDefault()
      control.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
