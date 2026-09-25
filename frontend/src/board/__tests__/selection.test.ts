import { describe, expect, it } from 'vitest'

import {
  EMPTY_SELECTION,
  type Selection,
  selectionGesture,
  selectionReducer,
} from '@/board/selection'

const order = [10, 20, 30, 40, 50]

const run = (state: Selection, ...actions: Parameters<typeof selectionReducer>[1][]) =>
  actions.reduce(selectionReducer, state)

describe('selectionReducer', () => {
  it('toggles an issue in and out, moving the anchor each time', () => {
    const once = run(EMPTY_SELECTION, { type: 'toggle', id: 20 })
    expect(once).toEqual({ ids: [20], anchor: 20 })
    expect(run(once, { type: 'toggle', id: 20 })).toEqual({ ids: [], anchor: 20 })
  })

  it('selects a range from the anchor in view order, either direction', () => {
    const anchored = run(EMPTY_SELECTION, { type: 'toggle', id: 20 })
    expect(run(anchored, { type: 'range', id: 40, order }).ids).toEqual([20, 30, 40])
    expect(run(anchored, { type: 'range', id: 10, order }).ids).toEqual([20, 10])
  })

  it('adds a range to what was already selected rather than replacing it', () => {
    const state = run(
      EMPTY_SELECTION,
      { type: 'toggle', id: 50 },
      { type: 'toggle', id: 10 },
      { type: 'range', id: 20, order },
    )
    expect([...state.ids].sort()).toEqual([10, 20, 50])
  })

  it('keeps the anchor after a range, so a second shift-click re-extends from it', () => {
    const state = run(
      EMPTY_SELECTION,
      { type: 'toggle', id: 30 },
      { type: 'range', id: 50, order },
    )
    expect(state.anchor).toBe(30)
  })

  it('treats a shift-click with no anchor as picking that one issue', () => {
    expect(run(EMPTY_SELECTION, { type: 'range', id: 30, order })).toEqual({
      ids: [30],
      anchor: 30,
    })
  })

  it('drops issues that left the view, and the anchor with them', () => {
    const state = run(
      EMPTY_SELECTION,
      { type: 'toggle', id: 10 },
      { type: 'toggle', id: 20 },
      { type: 'retain', visible: [10, 30] },
    )
    expect(state).toEqual({ ids: [10], anchor: null })
  })

  it('returns the same object when nothing changes', () => {
    const state = run(EMPTY_SELECTION, { type: 'toggle', id: 10 })
    expect(selectionReducer(state, { type: 'retain', visible: order })).toBe(state)
    expect(selectionReducer(EMPTY_SELECTION, { type: 'clear' })).toBe(EMPTY_SELECTION)
  })
})

describe('selectionGesture', () => {
  const click = { shiftKey: false, metaKey: false, ctrlKey: false }

  it('reads shift as a range and cmd or ctrl as a toggle', () => {
    expect(selectionGesture({ ...click, shiftKey: true })).toBe('range')
    expect(selectionGesture({ ...click, metaKey: true })).toBe('toggle')
    expect(selectionGesture({ ...click, ctrlKey: true })).toBe('toggle')
  })

  it('leaves a plain click alone, so it still opens the issue', () => {
    expect(selectionGesture(click)).toBeNull()
  })
})
