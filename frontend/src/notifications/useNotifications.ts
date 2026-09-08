import { useQueryClient } from '@tanstack/react-query'

import {
  getListNotificationsNotificationsGetQueryKey,
  getUnreadCountNotificationsUnreadCountGetQueryKey,
  useListNotificationsNotificationsGet,
  useMarkAllReadNotificationsReadAllPost,
  useUnreadCountNotificationsUnreadCountGet,
  useUpdateNotificationNotificationsNotificationIdPatch,
} from '@/api/generated/endpoints/notifications/notifications'
import type { NotificationRead } from '@/api/generated/models'

/**
 * How often the badge asks the server whether anything happened.
 *
 * Polling rather than a socket: SoftTrack has no realtime layer yet (it is on
 * the roadmap), and one cheap request a minute per open tab is a fair price
 * for the inbox not being stale until you reload. The endpoint returns a
 * single integer, which is why the count is polled and the list is not.
 */
const POLL_MS = 60_000

/** The unread badge. Cheap enough to keep on every board. */
export function useUnreadCount() {
  const query = useUnreadCountNotificationsUnreadCountGet({
    query: {
      refetchInterval: POLL_MS,
      // A tab left open in the background is not being read, so it does not
      // need fresh numbers -- and twenty of them would still be polling.
      refetchIntervalInBackground: false,
    },
  })
  return query.data?.unread ?? 0
}

/**
 * The inbox itself, plus the two writes it makes.
 *
 * Only ever called from the panel, which mounts when the panel opens -- so
 * the expensive half of the feature is not fetched on every board load. The
 * badge is the part that runs all the time, and it is one integer.
 */
export function useInbox() {
  const queryClient = useQueryClient()

  const query = useListNotificationsNotificationsGet()
  const update = useUpdateNotificationNotificationsNotificationIdPatch()
  const readAll = useMarkAllReadNotificationsReadAllPost()

  /** Both queries move together; anything that changes one changes the other. */
  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: getListNotificationsNotificationsGetQueryKey(),
    })
    queryClient.invalidateQueries({
      queryKey: getUnreadCountNotificationsUnreadCountGetQueryKey(),
    })
  }

  return {
    notifications: (query.data?.items ?? []) as NotificationRead[],
    isLoading: query.isLoading,
    async setRead(notification: NotificationRead, read: boolean) {
      await update.mutateAsync({
        notificationId: notification.id,
        data: { read },
      })
      refresh()
    },
    async markAllRead() {
      await readAll.mutateAsync()
      refresh()
    },
  }
}
