// @vitest-environment jsdom
/**
 * Settings → Notifications as a grid of kinds against channels (#263).
 *
 * Drawn from what the server registers: these check a row per kind and a
 * column per channel, the two kinds that are always on in the app, the email
 * column missing without a mail server, and muting a team.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NotificationChannel, NotificationSettings as Settings } from '@/api/generated/models'
import NotificationSettings from '@/settings/NotificationSettings'

const mocks = vi.hoisted(() => ({
  settings: null as unknown,
  update: { mutateAsync: vi.fn(), isPending: false },
}))

vi.mock('@/api/generated/endpoints/notifications/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/generated/endpoints/notifications/notifications')>()),
  useGetNotificationSettingsNotificationsSettingsGet: () => ({ data: mocks.settings, isLoading: false }),
  useUpdateNotificationSettingsNotificationsSettingsPatch: () => mocks.update,
}))

function kind(key: string, name: string, description: string, channels: NotificationChannel[], locked = false) {
  return {
    kind: key,
    name,
    description,
    through_mute: locked,
    channels: channels.map((channel) => ({
      channel,
      enabled: !(key === 'status_changed' && channel === 'email'),
      locked: locked && channel === 'app',
    })),
  }
}

function settings(email: boolean, extra: ReturnType<typeof kind>[] = []): Settings {
  const channels: NotificationChannel[] = email ? ['app', 'email'] : ['app']
  return {
    email_delivery_configured: email,
    channels,
    kinds: [
      kind('assigned', 'Assigned to you', 'A ticket becomes yours.', channels, true),
      kind('mentioned', 'Mentioned', 'Somebody writes @you.', channels, true),
      kind('commented', 'A comment on a ticket you watch', '', channels),
      kind('status_changed', 'A status change on a ticket you watch', '', channels),
      ...extra,
    ],
    teams: [
      { team_id: 1, key: 'ENG', name: 'Engineering', muted: false },
      { team_id: 2, key: 'SUP', name: 'Support', muted: true },
    ],
  }
}

const checked = (element: HTMLElement) => (element as HTMLInputElement).checked

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NotificationSettings />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

beforeEach(() => {
  mocks.settings = settings(true)
  mocks.update.mutateAsync.mockReset()
  mocks.update.mutateAsync.mockResolvedValue(settings(true))
})

afterEach(() => {
  cleanup()
})

describe('NotificationSettings', () => {
  it('draws a row per kind and a column per channel', () => {
    renderPage()

    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Notifications',
      'In the app',
      'By email',
    ])
    const rows = screen.getAllByRole('rowheader').map((cell) => cell.textContent)
    expect(rows).toEqual([
      'Assigned to youA ticket becomes yours.',
      'MentionedSomebody writes @you.',
      'A comment on a ticket you watch',
      'A status change on a ticket you watch',
    ])
    expect(checked(screen.getByRole('switch', { name: 'A status change on a ticket you watch, by email' }))).toBe(false)
    expect(checked(screen.getByRole('switch', { name: 'A comment on a ticket you watch, in the app' }))).toBe(true)
  })

  it('shows assigned and mentioned as always on in the app, with no switch', () => {
    renderPage()

    const assigned = screen.getAllByRole('row')[1]
    expect(within(assigned).getByText('always')).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'Assigned to you, in the app' })).toBeNull()
    expect(checked(screen.getByRole('switch', { name: 'Assigned to you, by email' }))).toBe(true)
  })

  it('shows a kind the page has no words for under the name it registered with', () => {
    mocks.settings = settings(true, [kind('due_soon', 'Due tomorrow', 'The day before a due date.', ['app', 'email'])])
    renderPage()

    expect(screen.getByText('Due tomorrow')).toBeTruthy()
    expect(screen.getByText('The day before a due date.')).toBeTruthy()
  })

  it('has no email column without a mail server, and says why', () => {
    mocks.settings = settings(false)
    renderPage()

    expect(screen.queryByText('By email')).toBeNull()
    expect(screen.queryByRole('switch', { name: /by email/ })).toBeNull()
    expect(
      screen.getByText('This SoftTrack has no mail server configured, so there is no email column.'),
    ).toBeTruthy()
  })

  it('saves one switch at a time', async () => {
    const user = renderPage()

    await user.click(screen.getByRole('switch', { name: 'A status change on a ticket you watch, by email' }))

    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({
      data: { preferences: [{ kind: 'status_changed', channel: 'email', enabled: true }] },
    })
  })

  it('mutes and unmutes a team', async () => {
    const user = renderPage()

    expect(screen.getByText('Everything the grid above allows.')).toBeTruthy()
    expect(screen.getByText('Muted: nothing from it except assignments and mentions.')).toBeTruthy()
    expect(checked(screen.getByRole('switch', { name: /Support/ }))).toBe(false)

    await user.click(screen.getByRole('switch', { name: /Engineering/ }))
    expect(mocks.update.mutateAsync).toHaveBeenCalledWith({ data: { teams: [{ team_id: 1, muted: true }] } })
  })

  it('says so when a switch is refused', async () => {
    mocks.update.mutateAsync.mockRejectedValue(new Error('nope'))
    const user = renderPage()

    await user.click(screen.getByRole('switch', { name: 'A comment on a ticket you watch, in the app' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
