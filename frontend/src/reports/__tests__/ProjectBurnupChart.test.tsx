// @vitest-environment jsdom
/**
 * The project burnup (issue #64): scope against completed work, in issues or
 * points, and saying so when the points total is only a floor.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import type { ProjectBurnup, ProjectBurnupPoint } from '@/api/generated/models'
import { unestimatedNote } from '@/reports/burnup'
import { ProjectBurnupChart } from '@/reports/ProjectBurnupChart'

function point(day: string, fields: Partial<ProjectBurnupPoint> = {}): ProjectBurnupPoint {
  return {
    day,
    scope_issues: 3,
    completed_issues: 1,
    scope_points: 8,
    completed_points: 3,
    unestimated_issues: 0,
    ...fields,
  }
}

function chart(points: ProjectBurnupPoint[], started_on: string | null = '2026-09-20') {
  const data: ProjectBurnup = { project_id: 5, project_name: 'Platform', started_on, points }
  render(<ProjectBurnupChart data={data} />)
  return userEvent.setup()
}

afterEach(cleanup)

describe('the burnup', () => {
  it('reads in issues by default, and in points on request', async () => {
    const user = chart([point('2026-09-20'), point('2026-09-21', { scope_issues: 4 })])
    expect(screen.getByRole('img', { name: 'Burnup for Platform, in issues' })).toBeTruthy()
    expect(screen.getByText(/1 of 4\s+issues/)).toBeTruthy()

    await user.click(screen.getByRole('tab', { name: 'Points' }))
    expect(screen.getByRole('img', { name: 'Burnup for Platform, in points' })).toBeTruthy()
    expect(screen.getByText(/3 of 8\s+pts/)).toBeTruthy()
  })

  it('says where the chart starts, since the history does not go further back', () => {
    chart([point('2026-09-20')])
    expect(screen.getByText(/since 20 Sep 2026, the first day history records/)).toBeTruthy()
  })

  it('says plainly when the points scope is only a floor', async () => {
    const user = chart([point('2026-09-20', { unestimated_issues: 2 })])
    // Not in issues, where every issue is counted whether sized or not.
    expect(screen.queryByRole('note')).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'Points' }))
    expect(screen.getByRole('note').textContent).toMatch(/2 issues in scope have no estimate/)
    expect(screen.getByText(/3 of 8\+\s+pts/)).toBeTruthy()
  })

  it('draws nothing for a project with no history, and says why', () => {
    chart([], null)
    expect(screen.getByText(/No history for this project yet/)).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('unestimatedNote', () => {
  it('is null when everything in scope is sized', () => {
    expect(unestimatedNote(point('2026-09-20'))).toBeNull()
    expect(unestimatedNote(undefined)).toBeNull()
  })

  it('counts one and many', () => {
    expect(unestimatedNote(point('d', { unestimated_issues: 1 }))).toMatch(/^1 issue in scope has/)
    expect(unestimatedNote(point('d', { unestimated_issues: 3 }))).toMatch(/^3 issues in scope have/)
  })
})
