// @vitest-environment jsdom
/**
 * M goes to My work (#258), from wherever it is offered -- and never while
 * somebody is typing an "m".
 */
import { cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useGlobalShortcuts } from '@/keyboard/useGlobalShortcuts'

function setUp(openMyWork?: () => void) {
  renderHook(() =>
    useGlobalShortcuts({
      togglePalette: vi.fn(),
      closeTop: vi.fn(),
      openShortcuts: vi.fn(),
      openMyWork,
      suppressed: false,
    }),
  )
}

afterEach(cleanup)

describe('M for My work', () => {
  it('goes to My work', () => {
    const openMyWork = vi.fn()
    setUp(openMyWork)
    fireEvent.keyDown(window, { key: 'm' })
    expect(openMyWork).toHaveBeenCalledOnce()
  })

  it('is only a letter while typing', () => {
    const openMyWork = vi.fn()
    setUp(openMyWork)
    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.keyDown(input, { key: 'm' })
    expect(openMyWork).not.toHaveBeenCalled()
    input.remove()
  })
})
