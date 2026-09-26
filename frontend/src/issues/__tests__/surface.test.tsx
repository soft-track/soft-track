// @vitest-environment jsdom
/**
 * One address per issue, two surfaces (#112): the location state says which,
 * and following a link from inside an issue stays on the surface it is on.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import {
  type IssueSurface,
  IssueSurfaceContext,
  issuePath,
  surfaceFor,
  useOpenRelatedIssue,
} from '@/issues/surface'

afterEach(cleanup)

describe('surfaceFor', () => {
  it('is the panel only when the location asks for it', () => {
    expect(surfaceFor({ issueSurface: 'panel' })).toBe('panel')
  })

  it('is the page for anything else: a pasted link has no state at all', () => {
    expect(surfaceFor(null)).toBe('page')
    expect(surfaceFor(undefined)).toBe('page')
    expect(surfaceFor({})).toBe('page')
    expect(surfaceFor({ issueSurface: 'modal' })).toBe('page')
    expect(surfaceFor('panel')).toBe('page')
  })
})

it('builds the one address an issue has', () => {
  expect(issuePath({ team_key: 'ENG', number: 42 })).toBe('/ENG/issue/42')
})

function OpenParent() {
  const open = useOpenRelatedIssue()
  return (
    <button type="button" onClick={() => open({ team_key: 'OPS', number: 7 })}>
      Open the parent
    </button>
  )
}

function Where() {
  const location = useLocation()
  return (
    <output data-surface={surfaceFor(location.state)}>{location.pathname}</output>
  )
}

function renderInside(surface?: IssueSurface) {
  const opener = surface ? (
    <IssueSurfaceContext.Provider value={surface}>
      <OpenParent />
    </IssueSurfaceContext.Provider>
  ) : (
    <OpenParent />
  )
  render(
    <MemoryRouter initialEntries={['/ENG/issue/42']}>
      <Routes>
        <Route path="/ENG/issue/42" element={opener} />
        <Route path="/OPS/issue/:n" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('useOpenRelatedIssue', () => {
  it('keeps a link followed from the panel in the panel', async () => {
    renderInside('panel')
    await userEvent.click(screen.getByRole('button', { name: 'Open the parent' }))
    const where = screen.getByRole('status')
    expect(where.textContent).toBe('/OPS/issue/7')
    expect(where.dataset.surface).toBe('panel')
  })

  it('keeps a link followed from the page on a page', async () => {
    renderInside('page')
    await userEvent.click(screen.getByRole('button', { name: 'Open the parent' }))
    expect(screen.getByRole('status').dataset.surface).toBe('page')
  })

  it('opens the page from outside any surface', async () => {
    renderInside()
    await userEvent.click(screen.getByRole('button', { name: 'Open the parent' }))
    expect(screen.getByRole('status').dataset.surface).toBe('page')
  })
})
