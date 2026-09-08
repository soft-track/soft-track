/**
 * Which floating layers are open, as a stack.
 *
 * The board used to hold five independent booleans for these and a
 * hand-written if/else chain deciding which one Escape should close. A stack
 * makes "close the shallowest thing" mean exactly that -- the most recently
 * opened -- with no chain to keep in sync when a sixth overlay arrives.
 *
 * Every action that changes nothing returns the *same* array. That is not a
 * micro-optimisation: a fresh empty array on Escape re-rendered the board
 * between window listeners, which unregistered the issue panel's own Escape
 * handler before it ran, so Escape silently did nothing on an open issue.
 *
 * Pure so it can be tested without React.
 */
export type Overlay =
  | 'newIssue'
  | 'palette'
  | 'shortcuts'
  | 'newCycle'
  | 'import'
  | 'notifications'
  | 'saveView'

/** Bottom first; the last entry is on top. */
export type OverlayStack = readonly Overlay[]

export type OverlayAction =
  | { type: 'open'; overlay: Overlay }
  | { type: 'close'; overlay: Overlay }
  | { type: 'toggle'; overlay: Overlay }
  | { type: 'closeTop' }

export function overlayReducer(stack: OverlayStack, action: OverlayAction): OverlayStack {
  switch (action.type) {
    case 'open':
      // Re-opening something already on top is a no-op; otherwise bring it
      // to the top rather than stacking a duplicate.
      if (stack[stack.length - 1] === action.overlay) return stack
      return [...stack.filter((o) => o !== action.overlay), action.overlay]
    case 'close':
      if (!stack.includes(action.overlay)) return stack
      return stack.filter((o) => o !== action.overlay)
    case 'toggle':
      return stack.includes(action.overlay)
        ? overlayReducer(stack, { type: 'close', overlay: action.overlay })
        : overlayReducer(stack, { type: 'open', overlay: action.overlay })
    case 'closeTop':
      if (stack.length === 0) return stack
      return stack.slice(0, -1)
  }
}
