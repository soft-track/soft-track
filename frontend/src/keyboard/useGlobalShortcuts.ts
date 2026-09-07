import { useEffect } from 'react'

import { isPlainKey, isTypingTarget } from '@/keyboard/typing'

/**
 * The app-wide keys: ⌘K, C, ?, / and Escape.
 *
 * Every single-key binding is gated on `isTypingTarget` first. Without that
 * guard, typing an issue title containing "c" fires "create issue" -- which
 * is how keyboard shortcuts get added and then quietly turned off again.
 */
export function useGlobalShortcuts({
  togglePalette,
  closeTop,
  openNewIssue,
  openShortcuts,
  suppressed,
}: {
  togglePalette: () => void
  /** Escape: close the shallowest open layer, never two at once. */
  closeTop: () => void
  openNewIssue: () => void
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

      if (event.key === 'c') {
        event.preventDefault()
        openNewIssue()
      } else if (event.key === '?') {
        event.preventDefault()
        openShortcuts()
      } else if (event.key === '/') {
        event.preventDefault()
        document
          .querySelector<HTMLInputElement>('input[type="search"], input[placeholder*="Search"]')
          ?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePalette, closeTop, openNewIssue, openShortcuts, suppressed])
}
