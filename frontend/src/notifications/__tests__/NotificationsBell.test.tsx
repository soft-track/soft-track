// @vitest-environment jsdom
/**
 * The bell, rendered with the unread count primed into the query cache -- the
 * same arrangement as LoginPage.test.tsx, so the assertions see the resolved
 * count rather than the pending state.
 *
 * What matters here is what a screen reader gets. A changing aria-label on a
 * button is never announced, so the count has to also land in a live region
 * for the poll to be audible at all -- and that region has to be the same
 * node before and after the change, or there is no change to announce.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { getUnreadCountNotificationsUnreadCountGetQueryKey } from '@/api/generated/endpoints/notifications/notifications'
import { NotificationsBell } from '@/notifications/NotificationsBell'

const key = getUnreadCountNotificationsUnreadCountGetQueryKey()

function renderBell(unread: number) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(key, { unread })

  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <NotificationsBell open={false} onToggle={() => {}} onClose={() => {}} />
    </QueryClientProvider>,
  )
  return { container, queryClient }
}

/** The polite live region; throws if there is no such region. */
function regionIn(container: HTMLElement): HTMLElement {
  const region = container.querySelector<HTMLElement>('[aria-live="polite"]')
  if (!region) throw new Error('no aria-live="polite" region rendered')
  return region
}

afterEach(cleanup)

describe('NotificationsBell', () => {
  it('names the button with the count', () => {
    renderBell(3)
    expect(screen.getByRole('button', { name: 'Notifications (3 unread)' })).toBeTruthy()
    cleanup()

    renderBell(0)
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy()
  })

  it('puts the count in a polite live region', () => {
    expect(regionIn(renderBell(3).container).textContent).toBe('3 unread notifications')
    cleanup()
    expect(regionIn(renderBell(1).container).textContent).toBe('1 unread notification')
  })

  it('keeps the region in the markup but empty at zero, so nothing extra is said', () => {
    // Present even when empty: a live region only announces changes made
    // after it exists, so one that mounts with the first notification would
    // miss it.
    expect(regionIn(renderBell(0).container).textContent).toBe('')
  })

  it('announces a change by updating the same region, not by mounting a new one', async () => {
    const { container, queryClient } = renderBell(0)
    const before = regionIn(container)
    expect(before.textContent).toBe('')

    // The setTimeout is for React Query, which batches its observer
    // notifications: without it the assertions see the pre-update text.
    await act(async () => {
      queryClient.setQueryData(key, { unread: 3 })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await waitFor(() => expect(before.textContent).not.toBe(''))

    // Same node, new text -- that is what makes it an announcement. A region
    // that remounts on the change (a `key`, a conditional that flips) would
    // be a fresh, silent one.
    expect(regionIn(container)).toBe(before)
    expect(before.textContent).toBe('3 unread notifications')
  })
})
