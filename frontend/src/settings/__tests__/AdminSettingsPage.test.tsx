// @vitest-environment jsdom
/**
 * Administration → Settings → Teams (#306): who may create a team, the people
 * named, the environment winning, and the requests waiting for a site admin.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AdminSettingsPage from '@/settings/AdminSettingsPage'

const person = (id: number, full_name: string) => ({
  id,
  email: `${id}@example.com`,
  username: `u${id}`,
  full_name,
  avatar_color: '#3b82f6',
  is_active: true,
  is_external: false,
})

const mocks = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  update: vi.fn(),
  approve: vi.fn(),
  decline: vi.fn(),
}))

vi.mock('@/api/generated/endpoints/admin/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/admin/admin')>()),
  useGetTeamCreationAdminTeamCreationGet: () => ({ data: mocks.settings, isPending: false }),
  useUpdateTeamCreationAdminTeamCreationPut: () => ({ mutateAsync: mocks.update, isPending: false }),
  useApproveTeamRequestAdminTeamRequestsRequestIdApprovePost: () => ({
    mutateAsync: mocks.approve,
    isPending: false,
  }),
  useDeclineTeamRequestAdminTeamRequestsRequestIdDeclinePost: () => ({
    mutateAsync: mocks.decline,
    isPending: false,
  }),
  useListUsersAdminUsersGet: () => ({ data: { items: [] } }),
}))

const REQUEST = {
  id: 7,
  requester: person(4, 'Tomas Silva'),
  name: 'Brand studio',
  key: 'BRD',
  reason: 'The rebrand needs its own board until March.',
  state: 'pending',
  created_at: new Date().toISOString(),
}

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AdminSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.settings = {
    policy: 'named_people',
    from_environment: false,
    named_people: [person(2, 'Amina Khan'), person(3, 'Lena Fischer')],
    requests: [REQUEST],
  }
  mocks.update.mockReset().mockResolvedValue({})
  mocks.approve.mockReset().mockResolvedValue({})
  mocks.decline.mockReset().mockResolvedValue({})
})

afterEach(() => {
  cleanup()
})

describe('AdminSettingsPage', () => {
  it('shows who may create a team, and the people named', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Teams' })).toBeTruthy()
    expect(
      screen.getByText(
        'Who may create a team on this SoftTrack. A team takes a key, and a key is never given back.',
      ),
    ).toBeTruthy()
    expect((screen.getByLabelText('Named people') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('Amina Khan')).toBeTruthy()
    expect(screen.getByText('Lena Fischer')).toBeTruthy()
    expect(screen.getByText(/in the environment, which wins\./)).toBeTruthy()
  })

  it('saves a choice at once, keeping the people named', async () => {
    const user = renderPage()
    await user.click(screen.getByLabelText('Site admins only'))
    expect(mocks.update).toHaveBeenCalledWith({
      data: { policy: 'site_admins', named_people_ids: [2, 3] },
    })
  })

  it('takes somebody off the list', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Take Amina Khan off' }))
    expect(mocks.update).toHaveBeenCalledWith({
      data: { policy: 'named_people', named_people_ids: [3] },
    })
  })

  it('cannot change what the environment sets', () => {
    mocks.settings = { ...mocks.settings, policy: 'site_admins', from_environment: true }
    renderPage()
    for (const label of [/^Anyone signed in/, 'Site admins only', 'Named people']) {
      expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true)
    }
    expect(screen.getByText(/Set as/)).toBeTruthy()
  })

  it('lists a request, and approving it creates the team', async () => {
    const user = renderPage()
    const requests = screen.getByRole('region', { name: 'Asked for · 1' })
    expect(within(requests).getByText(/asks for/).textContent).toBe(
      'Tomas Silva asks for Brand studio BRD',
    )
    expect(
      within(requests).getByText(/“The rebrand needs its own board until March\.” · /),
    ).toBeTruthy()
    await user.click(within(requests).getByRole('button', { name: 'Approve' }))
    expect(mocks.approve).toHaveBeenCalledWith({ requestId: 7 })
    expect(
      await screen.findByText('Brand studio is created, with Tomas Silva as its admin.'),
    ).toBeTruthy()
  })

  it('declines with a reason', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Decline…' }))
    const dialog = screen.getByRole('dialog', { name: 'Decline Brand studio?' })
    await user.type(
      within(dialog).getByLabelText('Why, for Tomas Silva (optional)'),
      'Use the Marketing team.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Decline' }))
    expect(mocks.decline).toHaveBeenCalledWith({
      requestId: 7,
      data: { reason: 'Use the Marketing team.' },
    })
  })

  it('has no requests card when nothing is waiting', () => {
    mocks.settings = { ...mocks.settings, requests: [] }
    renderPage()
    expect(screen.queryByText(/Asked for/)).toBeNull()
  })
})
