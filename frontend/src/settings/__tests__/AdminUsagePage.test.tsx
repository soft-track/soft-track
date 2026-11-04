// @vitest-environment jsdom
/**
 * Administration → Usage (#312): accounts, work, storage, email, webhooks and
 * API tokens as counts, naming teams and nothing of the content.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AdminUsagePage from '@/settings/AdminUsagePage'

const MB = 1024 * 1024
const GB = 1024 * MB

const weeks = Array.from({ length: 13 }, (_, i) => {
  const monday = new Date(Date.UTC(2026, 7, 10 + 7 * i))
  return {
    week_of: monday.toISOString().slice(0, 10),
    created: 30 + i,
    closed: 20 + i,
  }
})

const USAGE = {
  people: {
    active: 12,
    not_activated: 2,
    deactivated: 1,
    signed_in_last_7_days: 9,
    signed_in_last_30_days: 11,
  },
  work: { teams: 3, archived_teams: 1, weeks },
  storage: {
    size_bytes: 2_040_109_466,
    files: 1902,
    teams: [
      { team_id: 1, team_name: 'Engineering', size_bytes: 1.1 * GB },
      { team_id: 2, team_name: 'Support', size_bytes: 520 * MB },
      { team_id: 3, team_name: 'Product & Design', size_bytes: 290 * MB },
    ],
    largest: [
      // Whatever else a row carried, the page says its kind and its team.
      {
        kind: 'video',
        team_id: 1,
        team_name: 'Engineering',
        size_bytes: 212 * MB,
        filename: 'layoffs-all-hands.mp4',
      },
      { kind: 'archive', team_id: 1, team_name: 'Engineering', size_bytes: 96 * MB },
      { kind: 'video', team_id: 2, team_name: 'Support', size_bytes: 88 * MB },
      { kind: 'image', team_id: 3, team_name: 'Product & Design', size_bytes: 41 * MB },
    ],
  },
  email: {
    configured: true,
    sent: 318,
    failed: 4,
    last_error: {
      at: new Date().toISOString(),
      recipients: 1,
      error: '550 5.1.1 No such user here',
    },
  },
  webhooks: [
    { team_id: 1, team_name: 'Engineering', failed: 7, title: 'Salary review for Q4' },
    { team_id: 2, team_name: 'Support', failed: 0 },
    { team_id: 3, team_name: 'Product & Design', failed: 0 },
  ],
  api_tokens: { live: 6, never_used: 2 },
}

const mocks = vi.hoisted(() => ({ usage: vi.fn() }))

vi.mock('@/api/generated/endpoints/admin/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/admin/admin')>()),
  useGetUsageAdminUsageGet: mocks.usage,
}))

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AdminUsagePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** The number a tile shows over `label`. */
const tile = (label: string, inside: HTMLElement = document.body) =>
  within(inside).getByText(label).nextElementSibling?.textContent

const section = (name: string) => screen.getByRole('region', { name })

beforeEach(() => {
  mocks.usage.mockReset().mockReturnValue({ data: USAGE, isPending: false })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AdminUsagePage', () => {
  it('counts accounts by state and who signed in lately', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Usage' })).toBeTruthy()
    expect(
      screen.getByText(
        'Whether anybody uses this SoftTrack, how fast it is growing, and whether its email arrives.',
      ),
    ).toBeTruthy()
    expect(tile('active accounts')).toBe('12')
    expect(tile('not yet activated')).toBe('2')
    expect(tile('deactivated')).toBe('1')
    expect(tile('signed in, last 7 days')).toBe('9')
    expect(tile('signed in, last 30 days')).toBe('11')
  })

  it('charts tickets created and closed for each of the thirteen weeks', () => {
    renderPage()
    const tickets = section('Tickets, per week')
    expect(within(tickets).getByText('Created and closed, as counts.')).toBeTruthy()
    expect(within(tickets).getByText('3 teams in use, 1 archived')).toBeTruthy()
    const titles = tickets.querySelectorAll('svg title')
    expect(titles).toHaveLength(13)
    expect(titles[0].textContent).toBe('Week of 10 Aug: 30 created, 20 closed')
    expect(titles[12].textContent).toBe('Week of 2 Nov: 42 created, 32 closed')
  })

  it('gives attachment bytes in total and per team, and the largest files by kind', () => {
    renderPage()
    const attachments = section('Attachments')
    expect(within(attachments).getByText('1.9 GB in 1,902 files.')).toBeTruthy()
    const teams = within(attachments)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(teams).toEqual(['Engineering1.1 GB', 'Support520.0 MB', 'Product & Design290.0 MB'])

    const largest = within(section('The largest files'))
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(largest).toEqual([
      'video · Engineering212.0 MB',
      'archive · Engineering96.0 MB',
      'video · Support88.0 MB',
      'image · Product & Design41.0 MB',
    ])
  })

  it('gives email sent and failed over the week, and what the mail server said last', () => {
    renderPage()
    const email = section('Email, last 7 days')
    expect(tile('sent', email)).toBe('318')
    expect(tile('failed', email)).toBe('4')
    const lastError = section('Email · the last error')
    expect(within(lastError).getByText(/^today, \d\d:\d\d · to 1 address$/)).toBeTruthy()
    expect(within(lastError).getByText('550 5.1.1 No such user here')).toBeTruthy()
  })

  it('gives failed webhook deliveries by team, and live and unused API tokens', () => {
    renderPage()
    const webhooks = within(section('Webhooks, failed'))
    expect(webhooks.getByText('Engineering').nextElementSibling?.textContent).toBe('7')
    expect(webhooks.getByText('Support').nextElementSibling?.textContent).toBe('0')
    const tokens = section('API tokens')
    expect(tile('live', tokens)).toBe('6')
    expect(tile('never used', tokens)).toBe('2')
  })

  it('names teams and shows no ticket titles or file names', () => {
    renderPage()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Product & Design')
    expect(text).not.toContain('Salary review')
    expect(text).not.toContain('layoffs')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('says when there is nothing to show, and when no mail server is set up', () => {
    mocks.usage.mockReturnValue({
      data: {
        ...USAGE,
        storage: { size_bytes: 0, files: 0, teams: [], largest: [] },
        email: { configured: false, sent: 0, failed: 0, last_error: null },
        webhooks: [],
      },
      isPending: false,
    })
    renderPage()
    expect(screen.getByText('0 B in 0 files.')).toBeTruthy()
    expect(
      screen.getByText('No mail server is set up, so this instance sends no email.'),
    ).toBeTruthy()
    expect(screen.getByText('Nothing has failed in the last 7 days.')).toBeTruthy()
    expect(screen.getByText('No team has an outgoing webhook.')).toBeTruthy()
  })
})
