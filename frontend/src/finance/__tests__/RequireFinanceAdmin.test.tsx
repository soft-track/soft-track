// @vitest-environment jsdom
/**
 * A finance page opened without the flag (#130): a page that says who can
 * grant access, not a redirect -- and for a site admin, where to do it.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RequireFinanceAdmin } from '@/finance/RequireFinanceAdmin'

const mocks = vi.hoisted(() => ({
  user: { is_site_admin: false, is_finance_admin: false },
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: mocks.user, isLoading: false }),
}))

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/finance" element={<RequireFinanceAdmin />}>
          <Route path="runs" element={<p>The runs</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
})

describe('RequireFinanceAdmin', () => {
  it('shows the page to a finance admin', () => {
    mocks.user = { is_site_admin: false, is_finance_admin: true }
    renderAt('/settings/finance/runs')
    expect(screen.getByText('The runs')).toBeTruthy()
  })

  it('tells anybody else who can grant access, and how they got here', () => {
    mocks.user = { is_site_admin: false, is_finance_admin: false }
    renderAt('/settings/finance/runs')
    expect(screen.queryByText('The runs')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Finance is for finance admins' })).toBeTruthy()
    expect(
      screen.getByText(
        'A site admin can grant access from Administration → Users. You are seeing this because you followed a link to /settings/finance/runs.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('does not let a site admin in, and points them at where to grant it', () => {
    mocks.user = { is_site_admin: true, is_finance_admin: false }
    renderAt('/settings/finance/runs')
    expect(screen.queryByText('The runs')).toBeNull()
    const link = screen.getByRole('link', { name: 'Administration → Users' })
    expect(link.getAttribute('href')).toBe('/settings/admin/users')
  })
})
