import { useEffect, useRef, useState } from 'react'

/** What Tab can land on. Layout is not consulted, so this holds under jsdom too. */
const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) => !element.closest('[hidden], [inert], [aria-hidden="true"]'),
  )
}

/**
 * The open modal dialogs, innermost last. Only the innermost one traps Tab --
 * a dialog opened from inside another (adding issues from a project page
 * that has an issue open) takes over until it closes, then hands back.
 */
const open: HTMLElement[] = []

/**
 * Keep keyboard focus inside a modal dialog while it is open (#75).
 *
 * - On open, focus moves into the dialog, unless something in it has already
 *   taken focus with `autoFocus`.
 * - Tab and Shift+Tab cycle through the dialog's controls and wrap at the ends.
 * - On close, focus returns to whatever had it when the dialog opened.
 *
 * Put the returned ref on the element with `role="dialog"`, and give that
 * element `tabIndex={-1}` so it can hold focus itself when it has no
 * controls. Escape is left to each dialog, which already handles it.
 *
 * Tab is handled with a keydown listener rather than by pulling focus back on
 * `focusin`: a dialog may own popups rendered in a portal outside it, and a
 * focusin guard would snatch focus back from them.
 */
export function useFocusTrap<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  // Captured while rendering, before the commit: by the time an effect runs,
  // an `autoFocus` field inside the dialog has already taken focus, and the
  // opener would be lost.
  const [opener] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    open.push(dialog)
    if (!dialog.contains(document.activeElement)) {
      ;(tabbables(dialog)[0] ?? dialog).focus()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || open[open.length - 1] !== dialog) return
      const items = tabbables(dialog)
      if (items.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const outside = !dialog.contains(active)
      if (event.shiftKey && (active === first || active === dialog || outside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      open.splice(open.indexOf(dialog), 1)
      // Only if it is still on the page: a card that was deleted from inside
      // the dialog it opened has nowhere to be returned to.
      if (opener?.isConnected) opener.focus()
    }
  }, [opener])

  return ref
}
