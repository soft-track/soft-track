import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PEEK_DELAY_MS } from '@/board/peek'
import type { PeekController, Peeked } from '@/board/peekContext'

/**
 * The board's one quick peek (#113): which issue, anchored where, and the
 * hover-intent timer. See peekContext.ts for what it is and is not.
 *
 * The current peek is mirrored in a ref for the timers, which fire outside
 * any render and must see where things stand when they fire, not when they
 * were set.
 */
export function usePeek(): PeekController {
  const [peeked, setPeeked] = useState<Peeked | null>(null)
  const current = useRef<Peeked | null>(null)
  const pending = useRef<number | undefined>(undefined)

  const set = useCallback((next: Peeked | null) => {
    current.current = next
    setPeeked(next)
  }, [])
  const cancelPending = useCallback(() => {
    window.clearTimeout(pending.current)
    pending.current = undefined
  }, [])
  const close = useCallback(() => {
    cancelPending()
    if (current.current) set(null)
  }, [cancelPending, set])

  useEffect(() => () => window.clearTimeout(pending.current), [])

  return useMemo(
    () => ({
      peeked,
      close,
      toggle: (id, anchor) => {
        cancelPending()
        set(current.current?.id === id ? null : { id, anchor, via: 'keyboard' })
      },
      follow: (id, anchor) => {
        const now = current.current
        if (now?.via === 'keyboard' && now.id !== id) set({ id, anchor, via: 'keyboard' })
      },
      left: (id) => {
        // After the focus has landed: if it landed on another card, that
        // card's `follow` has already moved the peek there.
        window.setTimeout(() => {
          const now = current.current
          if (now?.via === 'keyboard' && now.id === id && !now.anchor.contains(document.activeElement)) {
            set(null)
          }
        }, 0)
      },
      hoverStart: (id, anchor) => {
        cancelPending()
        pending.current = window.setTimeout(() => {
          pending.current = undefined
          set({ id, anchor, via: 'pointer' })
        }, PEEK_DELAY_MS)
      },
      hoverEnd: (id) => {
        cancelPending()
        const now = current.current
        // A peek opened from the keyboard stays until the keyboard is done.
        if (now?.via === 'pointer' && now.id === id) set(null)
      },
    }),
    [peeked, close, cancelPending, set],
  )
}
