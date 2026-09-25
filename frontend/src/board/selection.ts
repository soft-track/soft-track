/**
 * Multi-select on the board and the list, as a pure reducer.
 *
 * The three gestures every file manager has taught people:
 *
 * - ⌘/Ctrl-click toggles one issue and makes it the anchor.
 * - Shift-click selects everything between the anchor and the clicked issue,
 *   in the order the view shows them, adding to what was already selected.
 * - A plain click is not a selection gesture at all -- it opens the issue, as
 *   it always has -- so this module never sees one.
 *
 * "The order the view shows them" is passed in rather than derived here, and
 * that is the point: the board and the list order the same issues differently,
 * and a range that skipped across a folded column would select cards nobody
 * could see. Each view hands over exactly what is on screen.
 *
 * Pure so it can be tested without React, like `overlays.ts`.
 */
export type Selection = {
  /** Selected issue ids, in the order they were picked. */
  ids: readonly number[]
  /** Where the next shift-click range starts. Null until something is picked. */
  anchor: number | null
}

export const EMPTY_SELECTION: Selection = { ids: [], anchor: null }

export type SelectionAction =
  | { type: 'toggle'; id: number }
  | { type: 'range'; id: number; order: readonly number[] }
  | { type: 'clear' }
  /** Drop anything no longer on screen -- after a filter change or a delete. */
  | { type: 'retain'; visible: readonly number[] }

export function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case 'toggle': {
      const ids = state.ids.includes(action.id)
        ? state.ids.filter((id) => id !== action.id)
        : [...state.ids, action.id]
      return { ids, anchor: action.id }
    }
    case 'range': {
      const to = action.order.indexOf(action.id)
      const from = state.anchor === null ? -1 : action.order.indexOf(state.anchor)
      // No anchor, or an anchor that has scrolled off the view: a shift-click
      // with nothing to extend from behaves like the first click of a range.
      if (to === -1 || from === -1) {
        return state.ids.includes(action.id)
          ? { ...state, anchor: action.id }
          : { ids: [...state.ids, action.id], anchor: action.id }
      }
      const [start, end] = from <= to ? [from, to] : [to, from]
      const range = action.order.slice(start, end + 1)
      const ids = [...state.ids, ...range.filter((id) => !state.ids.includes(id))]
      // The anchor stays put, so shift-clicking again re-extends from the
      // same place rather than from wherever the last range ended.
      return ids.length === state.ids.length ? state : { ...state, ids }
    }
    case 'clear':
      return state.ids.length === 0 && state.anchor === null ? state : EMPTY_SELECTION
    case 'retain': {
      const ids = state.ids.filter((id) => action.visible.includes(id))
      const anchor =
        state.anchor !== null && action.visible.includes(state.anchor) ? state.anchor : null
      // The same object when nothing was dropped, so the effect that runs this
      // on every refetch does not re-render the board for nothing.
      return ids.length === state.ids.length && anchor === state.anchor
        ? state
        : { ids, anchor }
    }
  }
}

/** Which gesture a click was, or null for a plain click that should open the issue. */
export function selectionGesture(event: {
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}): 'range' | 'toggle' | null {
  if (event.shiftKey) return 'range'
  if (event.metaKey || event.ctrlKey) return 'toggle'
  return null
}
