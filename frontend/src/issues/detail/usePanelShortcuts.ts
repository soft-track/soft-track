import { useEffect, useRef } from 'react'

import { isPlainKey, isTypingTarget } from '@/keyboard/typing'

/**
 * The keys that work while an issue panel is open: Escape, S, P, A, L.
 *
 * The listener is registered once and reads the latest `onClose` through a
 * ref. Re-registering it on every render put it *after* the board's global
 * listener, whose Escape handling re-rendered the board mid-dispatch and
 * removed this listener before it could run.
 */
export function usePanelShortcuts(onClose: () => void) {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Anything inside the panel that consumes Escape (the mention menu,
        // a native select) stops propagation before this runs, so by the
        // time it reaches here the user does mean the panel.
        onCloseRef.current()
        return
      }

      if (!isPlainKey(e) || isTypingTarget(e.target)) return

      // Focus the control rather than mutating anything: the value still gets
      // chosen deliberately, which is what keeps a stray keystroke from
      // silently reassigning someone's issue.
      const field = { s: 'status', p: 'priority', a: 'assignee', l: 'labels' }[
        e.key.toLowerCase()
      ]
      if (!field) return

      const control = document.querySelector<HTMLElement>(`[data-field="${field}"]`)
      if (!control) return
      e.preventDefault()
      control.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
