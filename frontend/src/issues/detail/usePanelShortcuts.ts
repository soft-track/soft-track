import { useEffect } from 'react'

import { isPlainKey, isTypingTarget } from '@/keyboard/typing'

/** The keys that work while an issue panel is open: Escape, S, P, A, L. */
export function usePanelShortcuts(onClose: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Anything inside the panel that consumes Escape (the mention menu,
        // a native select) stops propagation before this runs, so by the
        // time it reaches here the user does mean the panel.
        onClose()
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
  }, [onClose])
}
