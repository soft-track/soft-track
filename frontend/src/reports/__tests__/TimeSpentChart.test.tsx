// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { TimeSpent } from '@/api/generated/models'
import { TimeSpentChart } from '@/reports/TimeSpentChart'

afterEach(cleanup)

const DATA = {
  total_minutes: 330,
  by_person: [
    { user: { id: 2, full_name: 'Maya Chen' }, minutes: 240 },
    { user: { id: 1, full_name: 'Olivia Owner' }, minutes: 90 },
  ],
} as TimeSpent

describe('TimeSpentChart (#102)', () => {
  it('draws a bar per person, longest for the most time, with the numbers as text', () => {
    render(<TimeSpentChart title="Time in Sprint 4" note="Logged during the cycle." data={DATA} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual(['Maya Chen4h', 'Olivia Owner1h 30m'])
    const widths = rows.map(
      (row) => (row.querySelector('[aria-hidden] > span') as HTMLElement).style.width,
    )
    expect(widths).toEqual(['100%', '37.5%'])
    expect(screen.getByText(/5h 30m in all/)).toBeTruthy()
  })

  it('says so when nothing was logged', () => {
    render(
      <TimeSpentChart title="Time" note="x" data={{ total_minutes: 0, by_person: [] }} />,
    )
    expect(screen.getByText('No time logged.')).toBeTruthy()
  })
})
