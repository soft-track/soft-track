/**
 * Which floating layers are open, as a stack.
 *
 * The board used to hold five independent booleans for these and a
 * hand-written if/else chain deciding which one Escape should close. A stack
 * makes "close the shallowest thing" mean exactly that -- the most recently
 * opened -- with no chain to keep in sync when a sixth overlay arrives.
 *
 * Pure so it can be tested without React.
 */
export type Overlay = 'newIssue' | 'palette' | 'shortcuts' | 'newCycle' | 'import'

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
      // Re-opening something already open brings it to the top rather than
      // stacking a duplicate.
      return [...stack.filter((o) => o !== action.overlay), action.overlay]
    case 'close':
      return stack.filter((o) => o !== action.overlay)
    case 'toggle':
      return stack.includes(action.overlay)
        ? overlayReducer(stack, { type: 'close', overlay: action.overlay })
        : overlayReducer(stack, { type: 'open', overlay: action.overlay })
    case 'closeTop':
      return stack.slice(0, -1)
  }
}
