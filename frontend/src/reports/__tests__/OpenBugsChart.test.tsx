// @vitest-environment jsdom
/**
 * Open bugs by severity, week by week (#273): a line per severity some week
 * has, the critical one drawn last so it is never hidden under another, and
 * an axis of whole bugs.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { OpenBugsBySeverity } from '@/api/generated/models'
import { OpenBugsChart } from '@/reports/OpenBugsChart'

const week = (week_of: string, counts: Partial<OpenBugsBySeverity['weeks'][number]>) => ({
  week_of,
  critical: 0,
  major: 0,
  minor: 0,
  trivial: 0,
  unrated: 0,
  ...counts,
})

const DATA: OpenBugsBySeverity = {
  weeks: [
    week('2026-09-28', {}),
    week('2026-10-05', { major: 1 }),
    week('2026-10-12', { critical: 1, major: 2, trivial: 1, unrated: 1 }),
  ],
}

afterEach(cleanup)

describe('OpenBugsChart', () => {
  it('names the severities it draws, and how many are open now', () => {
    render(<OpenBugsChart data={DATA} />)
    expect(screen.getByText('What is open at the end of each week. 5 open now.')).toBeTruthy()
    for (const name of ['Critical', 'Major', 'Trivial']) expect(screen.getByText(name)).toBeTruthy()
    // Nothing was ever minor, so there is no line or key for it.
    expect(screen.queryByText('Minor')).toBeNull()
  })

  it('counts whole bugs up the axis', () => {
    const { container } = render(<OpenBugsChart data={DATA} />)
    const labels = [...container.querySelectorAll('text')]
      .map((text) => text.textContent)
      .filter((label) => /^\d+$/.test(label ?? ''))
    expect(labels).toEqual(['0', '1', '2'])
  })

  it('draws the critical line last, on top of any it meets', () => {
    const { container } = render(<OpenBugsChart data={DATA} />)
    const strokes = [...container.querySelectorAll('path')].map((path) => path.getAttribute('stroke'))
    expect(strokes.at(-1)).toBe('var(--color-priority-urgent)')
  })

  it('says so when no bug was open', () => {
    render(<OpenBugsChart data={{ weeks: [week('2026-10-12', {})] }} />)
    expect(screen.getByText('No bugs were open in these weeks.')).toBeTruthy()
  })
})
