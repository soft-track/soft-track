// @vitest-environment jsdom
/**
 * People asking to join, as a team's admins see them (#259): the person's
 * title, department and manager beside the request, their note, a role to
 * give, and Approve or Decline.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { JoinRequests } from '@/settings/JoinRequests'

const person = (id: number, full_name: string, username: string, is_external = false) => ({
  id,
  email: `${username}@x.dev`,
  username,
  full_name,
  avatar_color: '#123',
  is_active: true,
  is_external,
})

const YUKI = {
  id: 5,
  team_id: 7,
  requester: person(3, 'Yuki Sato', 'yuki'),
  job_title: 'Junior Engineer',
  department: 'Engineering',
  manager: person(2, 'Amina Khan', 'amina'),
  note: 'Amina said I’m on Engineering from Monday.',
  created_at: '2026-10-12T08:00:00',
  expires_at: '2026-10-19T08:00:00',
}

const mocks = vi.hoisted(() => ({
  requests: [] as unknown[],
  approve: vi.fn(),
  decline: vi.fn(),
}))

vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useListJoinRequestsTeamsTeamIdJoinRequestsGet: () => ({ data: mocks.requests }),
  useApproveJoinRequestTeamsTeamIdJoinRequestsJoinRequestIdApprovePost: () => ({
    mutateAsync: mocks.approve,
    isPending: false,
  }),
  useDeclineJoinRequestTeamsTeamIdJoinRequestsJoinRequestIdDeclinePost: () => ({
    mutateAsync: mocks.decline,
    isPending: false,
  }),
}))

function renderIt() {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <JoinRequests teamId={7} />
    </QueryClientProvider>,
  )
  return { user: userEvent.setup(), container }
}

beforeEach(() => {
  mocks.requests = [YUKI]
  mocks.approve.mockReset().mockResolvedValue({})
  mocks.decline.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('JoinRequests', () => {
  it('is nothing at all while nobody is asking', () => {
    mocks.requests = []
    const { container } = renderIt()
    expect(container.textContent).toBe('')
  })

  it('says who is asking, and what they wrote', () => {
    renderIt()
    expect(screen.getByText('Asking to join · 1')).toBeTruthy()
    expect(screen.getByText('@yuki')).toBeTruthy()
    expect(
      screen.getByText('Junior Engineer · Engineering · reports to Amina Khan'),
    ).toBeTruthy()
    expect(screen.getByText('“Amina said I’m on Engineering from Monday.”')).toBeTruthy()
  })

  it('approves with the role chosen, a member unless changed', async () => {
    const { user } = renderIt()
    const role = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Role for Yuki Sato' })
    expect(role.value).toBe('member')
    await user.selectOptions(role, 'guest')
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(mocks.approve).toHaveBeenCalledWith({
      teamId: 7,
      joinRequestId: 5,
      data: { role: 'guest' },
    })
  })

  it('declines', async () => {
    const { user } = renderIt()
    await user.click(screen.getByRole('button', { name: 'Decline' }))
    expect(mocks.decline).toHaveBeenCalledWith({ teamId: 7, joinRequestId: 5 })
  })

  it('offers somebody from outside only as a guest', () => {
    mocks.requests = [{ ...YUKI, requester: person(3, 'Yuki Sato', 'yuki', true) }]
    renderIt()
    const role = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Role for Yuki Sato' })
    expect(role.value).toBe('guest')
    expect(role.disabled).toBe(true)
  })
})
