// @vitest-environment jsdom
/**
 * What only somebody inside the organisation reaches (#317): shown to them,
 * and explained -- not redirected -- to an account from outside.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PersonLink } from '@/people/PersonLink'
import { InsidersOnly } from '@/team/InsidersOnly'

const mocks = vi.hoisted(() => ({ external: false, teams: [] as { name: string }[] }))

vi.mock('@/auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 1, is_external: mocks.external }, isLoading: false }),
  useIsExternal: () => mocks.external,
}))
vi.mock('@/team/useTeams', () => ({ useMyTeams: () => ({ data: mocks.teams }) }))

function renderAt(path: string, node: React.ReactNode) {
  render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>)
}

beforeEach(() => {
  mocks.external = false
  mocks.teams = [{ name: 'Engineering' }]
})
afterEach(cleanup)

describe('InsidersOnly', () => {
  it('shows the page to somebody inside', () => {
    renderAt('/people', <InsidersOnly area="people">The directory</InsidersOnly>)
    expect(screen.getByText('The directory')).toBeTruthy()
  })

  it('says why to somebody from outside, where they followed the link', () => {
    mocks.external = true
    renderAt('/people', <InsidersOnly area="people">The directory</InsidersOnly>)
    expect(screen.queryByText('The directory')).toBeNull()
    expect(
      screen.getByRole('heading', { name: 'People is for members of the organisation' }),
    ).toBeTruthy()
    const body = screen.getByText(/Your account is a guest of Engineering/).textContent
    expect(body).toContain('The people on the tickets you can see are named there.')
    expect(body).toContain('You followed a link to /people.')
    expect(screen.getByRole('link', { name: 'Back to the board' }).getAttribute('href')).toBe('/')
  })

  it('words it for an account on no team yet', () => {
    mocks.external = true
    mocks.teams = []
    renderAt('/settings/expenses', <InsidersOnly area="expenses">Claims</InsidersOnly>)
    expect(
      screen.getByRole('heading', { name: 'Expense claims are for members of the organisation' }),
    ).toBeTruthy()
    expect(screen.getByText(/not on a team yet/)).toBeTruthy()
  })
})

describe('a name, to somebody from outside', () => {
  const amina = { username: 'amina', full_name: 'Amina Khan' }

  it('is a link to the profile for somebody inside', () => {
    renderAt('/', <PersonLink person={amina} />)
    expect(screen.getByRole('link', { name: 'Amina Khan' }).getAttribute('href')).toBe('/people/amina')
  })

  it('is just the name for somebody from outside, who has no profiles to open', () => {
    mocks.external = true
    renderAt('/', <PersonLink person={amina} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Amina Khan')).toBeTruthy()
  })
})
