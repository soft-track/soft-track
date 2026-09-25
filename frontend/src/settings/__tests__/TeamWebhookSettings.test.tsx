// @vitest-environment jsdom
/**
 * The team's outbound webhooks page (issue #91).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TeamWebhookSettings from '@/settings/TeamWebhookSettings'

const ADA = {
  id: 10,
  email: 'ada@example.com',
  username: 'ada',
  full_name: 'Ada Lovelace',
  avatar_color: '#123',
  is_active: true,
}
const TEAM = { id: 7, name: 'Engineering', key: 'ENG', created_at: '2026-01-01T00:00:00Z' }

const mocks = vi.hoisted(() => ({
  role: 'admin',
  hooks: [] as unknown[],
  deliveries: [] as unknown[],
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
  ping: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/auth/useAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/useAuth')>()),
  useAuth: () => ({ user: ADA }),
}))
vi.mock('@/team/useTeams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/team/useTeams')>()),
  useTeamByKey: () => ({ team: TEAM, isLoading: false, isError: false, teams: [TEAM] }),
}))
vi.mock('@/api/generated/endpoints/teams/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/teams/teams')>()),
  useListTeamMembersTeamsTeamIdMembersGet: () => ({
    data: [{ role: mocks.role, joined_at: '2026-01-01T00:00:00Z', user: ADA }],
  }),
}))
vi.mock('@/api/generated/endpoints/outbound-webhooks/outbound-webhooks', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/api/generated/endpoints/outbound-webhooks/outbound-webhooks')
  >()),
  useListWebhooksTeamsTeamIdOutboundWebhooksGet: () => ({ data: mocks.hooks }),
  useListDeliveriesOutboundWebhooksWebhookIdDeliveriesGet: () => ({ data: mocks.deliveries }),
  useCreateWebhookTeamsTeamIdOutboundWebhooksPost: () => mocks.create,
  useUpdateWebhookOutboundWebhooksWebhookIdPatch: () => mocks.update,
  useDeleteWebhookOutboundWebhooksWebhookIdDelete: () => mocks.remove,
  usePingWebhookOutboundWebhooksWebhookIdPingPost: () => mocks.ping,
}))

const HOOK = {
  id: 4,
  team_id: 7,
  url: 'https://hooks.example.com/softtrack',
  events: ['issue.created'],
  is_enabled: true,
  consecutive_failures: 0,
  disabled_reason: null,
  secret_hint: 'whsec_…a1B2',
  created_at: '2026-09-25T09:00:00',
}

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/settings/teams/ENG/webhooks']}>
        <Routes>
          <Route path="/settings/teams/:teamKey/webhooks" element={<TeamWebhookSettings />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.role = 'admin'
  mocks.hooks = []
  mocks.deliveries = []
  for (const m of [mocks.create, mocks.update, mocks.remove, mocks.ping]) {
    m.mutateAsync.mockReset().mockResolvedValue(undefined)
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('webhooks settings', () => {
  it('is for team admins only', () => {
    mocks.role = 'member'
    renderPage()
    expect(screen.getByText(/set up by a team admin/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add webhook' })).toBeNull()
  })

  it('adds a webhook for the chosen events and shows the secret once', async () => {
    mocks.create.mutateAsync.mockResolvedValue({ ...HOOK, secret: 'whsec_theSecret' })
    const user = renderPage()

    await user.type(
      screen.getByPlaceholderText('https://example.com/softtrack-webhook'),
      'https://hooks.example.com/softtrack',
    )
    await user.click(screen.getByLabelText(/Comment added/))
    await user.click(screen.getByRole('button', { name: 'Add webhook' }))

    expect(mocks.create.mutateAsync).toHaveBeenCalledWith({
      teamId: 7,
      data: {
        url: 'https://hooks.example.com/softtrack',
        events: ['issue.created', 'comment.created'],
      },
    })
    await waitFor(() =>
      expect(screen.getByTestId('new-secret').textContent).toBe('whsec_theSecret'),
    )
  })

  it('says why a webhook was switched off, and turns it back on', async () => {
    mocks.hooks = [
      {
        ...HOOK,
        is_enabled: false,
        disabled_reason: 'Switched off after 5 deliveries in a row failed every retry.',
      },
    ]
    const user = renderPage()
    const card = screen.getByRole('region', { name: HOOK.url })
    expect(within(card).getByText(/failed every retry/)).toBeTruthy()

    await user.click(within(card).getByLabelText('Enabled'))
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      webhookId: 4,
      data: { is_enabled: true },
    })
  })

  it('pings, and shows what the receiver said', async () => {
    mocks.hooks = [HOOK]
    mocks.deliveries = [
      {
        id: 1,
        event: 'ping',
        status: 'failed',
        attempts: 4,
        response_status: 404,
        response_excerpt: 'No route',
        created_at: '2026-09-25T09:00:00',
      },
    ]
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Send a ping' }))
    expect(mocks.ping.mutateAsync).toHaveBeenCalledWith({ webhookId: 4 })

    await user.click(screen.getByRole('button', { name: 'Recent deliveries' }))
    expect(screen.getByText('HTTP 404')).toBeTruthy()
    expect(screen.getByText('No route')).toBeTruthy()
  })
})
