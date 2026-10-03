// @vitest-environment jsdom
/**
 * The page a share link opens (#245): read-only, no sign-in, one answer for
 * a link that does not work, and a password asked for when the link has one.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SharedPage as SharedPageData, SharedTicket } from '@/api/generated/models'
import SharedPage from '@/sharing/SharedPage'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/sharing/sharedUrl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sharing/sharedUrl')>()),
  SHARED_CLIENT: { get: mocks.get },
}))

const ticket = (n: number, title: string, category: 'started' | 'done'): SharedTicket => ({
  identifier: `ENG-${n}`,
  title,
  type: 'task',
  status: { name: category === 'done' ? 'Done' : 'In Progress', category, color: '#888' },
})

const PAGE: SharedPageData = {
  team_name: 'Engineering',
  kind: 'epic',
  title: 'Customer portal',
  description: 'Invoices, statements and sign-in for customers.',
  color: '#2fd4a7',
  target_date: '2026-11-15',
  ticket_count: 5,
  completed_ticket_count: 4,
  tickets: [
    ticket(10, 'Portal: invoice list page', 'started'),
    ticket(5, 'Portal: branding', 'done'),
    ticket(4, 'Rate-limit the API', 'done'),
    ticket(3, 'Statements export', 'done'),
    ticket(2, 'Sign-in page', 'done'),
  ],
  shows: { comments: false, assignees: false, estimates: false, attachments: false },
}

const refusal = (status: number, code: string) =>
  Object.assign(new Error(code), { response: { status, data: { code } } })

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/shared/tok']}>
        <Routes>
          <Route path="/shared/:token" element={<SharedPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.get.mockReset()
})
afterEach(cleanup)

describe('the shared page', () => {
  it('shows the epic, its progress and open work first, the finished folded away', async () => {
    mocks.get.mockResolvedValue({ data: PAGE })
    const user = renderPage()
    expect(await screen.findByRole('heading', { name: 'Customer portal' })).toBeTruthy()
    expect(screen.getByText('Shared by Engineering · read-only')).toBeTruthy()
    expect(screen.getByText('4 of 5 done')).toBeTruthy()
    expect(screen.getByText('target 15 Nov 2026')).toBeTruthy()
    expect(screen.getByText('Portal: invoice list page')).toBeTruthy()
    expect(screen.queryByText('Sign-in page')).toBeNull()
    await user.click(screen.getByRole('button', { name: '2 more, all done' }))
    expect(screen.getByText('Sign-in page')).toBeTruthy()
    // No session goes with it: the app's own client is not used.
    expect(mocks.get).toHaveBeenCalledWith('/shared/tok', { headers: {} })
  })

  it('says the same for a revoked, expired or unknown link, and no more', async () => {
    mocks.get.mockRejectedValue(refusal(404, 'share_link_inactive'))
    renderPage()
    expect(await screen.findByRole('heading', { name: 'This link is no longer active' })).toBeTruthy()
  })

  it('asks for the password, and opens with it', async () => {
    mocks.get.mockImplementation(async (_url: string, config: { headers: Record<string, string> }) => {
      if (config.headers['X-Share-Password'] === 'portal-2026') return { data: PAGE }
      throw refusal(401, config.headers['X-Share-Password'] ? 'share_password_wrong' : 'share_password_required')
    })
    const user = renderPage()
    await user.type(await screen.findByLabelText('Password'), 'guess')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByText('That is not the password for this link.')).toBeTruthy()

    await user.clear(screen.getByLabelText('Password'))
    await user.type(screen.getByLabelText('Password'), 'portal-2026')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Customer portal' })).toBeTruthy())
  })
})
