import { describe, expect, it } from 'vitest'

import { type OverlayStack, overlayReducer } from '@/board/overlays'

const run = (start: OverlayStack, ...actions: Parameters<typeof overlayReducer>[1][]) =>
  actions.reduce(overlayReducer, start)

describe('overlayReducer', () => {
  it('opens onto the top of the stack', () => {
    expect(run([], { type: 'open', overlay: 'newIssue' }, { type: 'open', overlay: 'palette' }))
      .toEqual(['newIssue', 'palette'])
  })

  it('closeTop closes the most recently opened thing and nothing else', () => {
    // The old if/else chain would have closed the palette first regardless
    // of order; a stack makes "shallowest" mean what it says.
    expect(run(['newIssue', 'palette'], { type: 'closeTop' })).toEqual(['newIssue'])
  })

  it('closeTop on an empty stack is a no-op rather than an error', () => {
    expect(run([], { type: 'closeTop' })).toEqual([])
  })

  it('closes a specific overlay wherever it sits', () => {
    expect(run(['newIssue', 'palette'], { type: 'close', overlay: 'newIssue' })).toEqual(['palette'])
  })

  it('closing something not open changes nothing', () => {
    expect(run(['palette'], { type: 'close', overlay: 'import' })).toEqual(['palette'])
  })

  it('re-opening brings to the top instead of duplicating', () => {
    expect(run(['palette', 'newIssue'], { type: 'open', overlay: 'palette' }))
      .toEqual(['newIssue', 'palette'])
  })

  it('toggle opens when closed and closes when open', () => {
    expect(run([], { type: 'toggle', overlay: 'palette' })).toEqual(['palette'])
    expect(run(['palette'], { type: 'toggle', overlay: 'palette' })).toEqual([])
  })

  it('never mutates the previous stack', () => {
    const start: OverlayStack = ['newIssue']
    run(start, { type: 'open', overlay: 'palette' }, { type: 'closeTop' })
    expect(start).toEqual(['newIssue'])
  })
})
