import { useCallback, useMemo, useReducer } from 'react'

import { type Overlay, overlayReducer } from '@/board/overlays'

export function useOverlays() {
  const [stack, dispatch] = useReducer(overlayReducer, [])

  const open = useCallback(
    (overlay: Overlay) => dispatch({ type: 'open', overlay }),
    [],
  )

  const close = useCallback(
    (overlay: Overlay) => dispatch({ type: 'close', overlay }),
    [],
  )

  const toggle = useCallback(
    (overlay: Overlay) => dispatch({ type: 'toggle', overlay }),
    [],
  )

  const closeTop = useCallback(
    () => dispatch({ type: 'closeTop' }),
    [],
  )

  return useMemo(
    () => ({
      isOpen: (overlay: Overlay) => stack.includes(overlay),
      top: stack[stack.length - 1] ?? null,
      open,
      close,
      toggle,
      closeTop,
    }),
    [stack, open, close, toggle, closeTop],
  )
}
