import { useMemo, useReducer } from 'react'

import { type Overlay, overlayReducer } from '@/board/overlays'

export function useOverlays() {
  const [stack, dispatch] = useReducer(overlayReducer, [])

  // One object per stack change, not per render: callers put this in
  // useCallback deps, and a fresh object every render would make the global
  // key listener re-attach on every keystroke in the search box.
  return useMemo(
    () => ({
      isOpen: (overlay: Overlay) => stack.includes(overlay),
      top: stack[stack.length - 1] ?? null,
      open: (overlay: Overlay) => dispatch({ type: 'open', overlay }),
      close: (overlay: Overlay) => dispatch({ type: 'close', overlay }),
      toggle: (overlay: Overlay) => dispatch({ type: 'toggle', overlay }),
      closeTop: () => dispatch({ type: 'closeTop' }),
    }),
    [stack],
  )
}
