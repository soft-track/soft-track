/**
 * The bell, rendered to static markup with the unread count primed into the
 * query cache -- the same arrangement as LoginPage.test.tsx, and for the same
 * reason: the suite has no DOM, and a primed cache means the assertions see
 * the resolved count rather than the pending state.
 *
 * What matters here is what a screen reader gets. A changing aria-label on a
 * button is never announced, so the count has to also land in a live region
 * for the poll to be audible at all.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { getUnreadCountNotificationsUnreadCountGetQueryKey } from '@/api/generated/endpoints/notifications/notifications'
import { NotificationsBell } from '@/notifications/NotificationsBell'

function render(unread: number) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(getUnreadCountNotificationsUnreadCountGetQueryKey(), { unread })

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <NotificationsBell open={false} onToggle={() => {}} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

/** The text inside the polite live region; throws if there is no such region. */
function announcementIn(html: string): string {
  const region = /<[a-z]+[^>]*aria-live="polite"[^>]*>([^<]*)<\/[a-z]+>/.exec(html)
  if (!region) throw new Error('no aria-live="polite" region rendered')
  return region[1]
}

describe('NotificationsBell', () => {
  it('names the button with the count', () => {
    expect(render(3)).toContain('aria-label="Notifications (3 unread)"')
    expect(render(0)).toContain('aria-label="Notifications"')
  })

  it('puts the count in a polite live region, so a change is announced', () => {
    expect(announcementIn(render(3))).toBe('3 unread notifications')
    expect(announcementIn(render(1))).toBe('1 unread notification')
  })

  it('keeps the region in the markup but empty at zero, so nothing extra is said', () => {
    // Present even when empty: a live region only announces changes made
    // after it exists, so one that mounts with the first notification would
    // miss it.
    expect(announcementIn(render(0))).toBe('')
  })
})
