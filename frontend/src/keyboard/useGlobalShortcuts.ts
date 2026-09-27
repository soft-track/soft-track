import { useEffect } from 'react'

import { isPlainKey, isTypingTarget } from '@/keyboard/typing'

/**
 * The app-wide keys: ⌘K, C, ?, / and Escape.
 *
 * Every single-key binding is gated on `isTypingTarget` first. Without that
 * guard, typing a ticket title containing "c" fires "create ticket" -- which
 * is how keyboard shortcuts get added and then quietly turned off again.
 */
export function useGlobalShortcuts({
  togglePalette,
  closeTop,
  openNewTicket,
  openShortcuts,
  suppressed,
}: {
  togglePalette: () => void
  /** Escape: close the shallowest open layer, never two at once. */
  closeTop: () => void
  /** Absent for a guest (#104), who has nothing to create. */
  openNewTicket?: () => void
  openShortcuts: () => void
  /** True while the palette or the cheatsheet is up, so C and ? stay quiet. */
  suppressed: boolean
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        togglePalette()
        return
      }

      if (event.key === 'Escape') {
        closeTop()
        return
      }

      if (!isPlainKey(event) || isTypingTarget(event.target)) return
      if (suppressed) return

      if (event.key === 'c' && openNewTicket) {
        event.preventDefault()
        openNewTicket()
      } else if (event.key === '?') {
        event.preventDefault()
        openShortcuts()
      } else if (event.key === '/') {
        event.preventDefault()
        document
          // By attribute rather than by its placeholder, which is translated (#106).
          .querySelector<HTMLInputElement>('[data-global-search]')
          ?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePalette, closeTop, openNewTicket, openShortcuts, suppressed])
}
