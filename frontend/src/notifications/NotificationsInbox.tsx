import { formatDistanceToNow } from 'date-fns'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

import { parseServerDate } from '@/api/dates'
import type { NotificationRead } from '@/api/generated/models'
import {
  describe,
  issueHref,
  KIND_META,
  panelPosition,
} from '@/notifications/notificationMeta'
import { useInbox } from '@/notifications/useNotifications'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/Icon'
import { Loading } from '@/ui/Loading'

/**
 * The inbox, as a panel hanging off the bell in the top bar.
 *
 * A panel rather than a page: everything in it is a link to somewhere else,
 * and a full route would put a navigation between "something happened" and
 * the issue it happened on. Opening one marks it read, which is the only
 * read-state change most people will ever make deliberately.
 *
 * Rendered into a portal, and positioned from a measured rect rather than by
 * sitting next to the bell in the markup. The top bar is a `.glass` surface,
 * and a `backdrop-filter` makes an element both a stacking context and the
 * containing block for `position: fixed` descendants. Nested inside it, this
 * panel was painted underneath the board's cards however high its z-index
 * went, and the full-screen layer that catches the click to close it covered
 * only the top bar. Both are gone once the panel is a child of <body>.
 */
export function NotificationsInbox({
  anchor,
  onClose,
}: {
  anchor: DOMRect
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { notifications, isLoading, setRead, markAllRead } = useInbox()
  const unread = notifications.filter((item) => !item.read).length

  const open = async (notification: NotificationRead) => {
    onClose()
    navigate(issueHref(notification))
    // After navigating, not before: the row is about to disappear behind the
    // issue panel either way, and a failed PATCH should not swallow the click.
    if (!notification.read) await setRead(notification, true)
  }

  return createPortal(
    <>
      {/* Catches the click that closes the panel. Transparent rather than a
          scrim: this is a dropdown, and dimming the board behind it would
          make a lightweight thing feel modal. */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-label="Notifications"
        style={panelPosition(anchor, window.innerWidth)}
        className="glass-menu fixed z-50 flex max-h-[70vh] w-[22rem] flex-col overflow-hidden rounded-panel"
      >
        <div className="hairline flex items-center justify-between gap-2 border-b px-3 py-2">
          <h2 className="text-sm font-semibold text-neutral-900">Notifications</h2>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markAllRead()}
              className="btn btn-ghost btn-xs text-neutral-500"
            >
              Mark all read
            </button>
          )}
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto">
          {isLoading ? (
            <Loading label="Loading notifications…" />
          ) : notifications.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Icon name="bell" size={22} className="mx-auto mb-2 text-neutral-300" />
              <p className="text-sm text-neutral-500">Nothing new.</p>
              <p className="mt-1 text-xs text-neutral-400">
                You will hear about issues you are assigned, mentioned on, or watching.
              </p>
            </div>
          ) : (
            <ul>
              {notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onOpen={() => open(notification)}
                  onToggleRead={() => setRead(notification, !notification.read)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}

function NotificationRow({
  notification,
  onOpen,
  onToggleRead,
}: {
  notification: NotificationRead
  onOpen: () => void
  onToggleRead: () => void
}) {
  const meta = KIND_META[notification.kind]

  return (
    <li className="hairline group relative border-b last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        data-unread={!notification.read}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-neutral-900/4 data-[unread=true]:bg-brand-500/6"
      >
        <span className="mt-0.5 shrink-0">
          {notification.actor ? (
            <Avatar user={notification.actor} size={24} />
          ) : (
            <Icon name={meta.icon} size={16} className="text-neutral-400" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <Icon
              name={meta.icon}
              size={11}
              style={{ color: meta.color }}
              aria-hidden="true"
            />
            <span className="truncate text-xs font-medium text-neutral-700">
              {describe(notification)}
            </span>
          </span>
          <span className="mt-0.5 flex items-baseline gap-1.5">
            <span className="identifier shrink-0 text-[11px] text-neutral-400">
              {notification.issue.identifier}
            </span>
            <span className="truncate text-[13px] text-neutral-900">
              {notification.issue.title}
            </span>
          </span>
          {notification.excerpt && (
            <span className="mt-0.5 line-clamp-2 block text-xs text-neutral-500">
              {notification.excerpt}
            </span>
          )}
          <span className="mt-0.5 block text-[11px] text-neutral-400">
            {formatDistanceToNow(parseServerDate(notification.created_at), {
              addSuffix: true,
            })}
          </span>
        </span>
      </button>

      {/* Outside the button above: a button inside a button is invalid HTML
          and the inner one never receives the click. */}
      <button
        type="button"
        onClick={onToggleRead}
        title={notification.read ? 'Mark as unread' : 'Mark as read'}
        aria-label={notification.read ? 'Mark as unread' : 'Mark as read'}
        className="btn btn-ghost btn-icon btn-xs absolute right-2 top-2 text-neutral-400 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Icon name={notification.read ? 'eye-off' : 'check'} size={13} />
      </button>
    </li>
  )
}
