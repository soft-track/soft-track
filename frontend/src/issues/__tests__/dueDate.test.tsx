// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DueBadge } from '@/issues/DueBadge'
import { isOverdue, shortDue } from '@/issues/dueDate'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('isOverdue', () => {
  it('is past the date and still open', () => {
    expect(isOverdue('2026-09-22', false, '2026-09-23')).toBe(true)
  })

  it('is not due today, nor anything already finished', () => {
    expect(isOverdue('2026-09-23', false, '2026-09-23')).toBe(false)
    expect(isOverdue('2026-09-01', true, '2026-09-23')).toBe(false)
  })
})

describe('DueBadge', () => {
  it('shows a compact date', () => {
    expect(shortDue('2026-09-12')).toBe('Sep 12')
  })

  it('says overdue in words as well as in red', () => {
    vi.useFakeTimers({ now: new Date('2026-09-23T12:00:00') })
    render(<DueBadge dueDate="2026-09-12" resolved={false} />)
    const badge = screen.getByTitle(/Due Saturday 12 September 2026 — overdue/)
    // Seen: the date. Heard: the date and that it is late, as one sentence (#106).
    expect(badge.querySelector('span[aria-hidden="true"]')?.textContent).toBe('Sep 12')
    expect(badge.querySelector('.sr-only')?.textContent).toBe('Sep 12 (overdue)')
    expect(badge.className).toMatch(/text-danger-600/)
  })

  it('is plain for a date still to come, or for finished work', () => {
    vi.useFakeTimers({ now: new Date('2026-09-23T12:00:00') })
    render(
      <>
        <DueBadge dueDate="2026-10-01" resolved={false} />
        <DueBadge dueDate="2026-09-01" resolved />
      </>,
    )
    for (const badge of [screen.getByText('Oct 1'), screen.getByText('Sep 1')]) {
      expect(badge.closest('span')!.className).not.toMatch(/danger/)
    }
  })
})
