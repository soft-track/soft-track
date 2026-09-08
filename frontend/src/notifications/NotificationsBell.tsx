import { useLayoutEffect, useRef, useState } from 'react'

import { badgeLabel } from '@/notifications/notificationMeta'
import { NotificationsInbox } from '@/notifications/NotificationsInbox'
import { useUnreadCount } from '@/notifications/useNotifications'
import { Icon } from '@/ui/Icon'

/**
 * The bell and its unread badge, with the inbox hanging off it.
 *
 * Open/closed is owned by the board's overlay stack rather than by this
 * component, so Escape closes it in the same order as everything else and two
 * layers never close on one keystroke. See board/overlays.ts.
 *
 * The panel itself is measured here and rendered into a portal -- see
 * NotificationsInbox for why it cannot simply be positioned against this
 * button.
 */
export function NotificationsBell({
  open,
  onToggle,
  onClose,
}: {
  open: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const unread = useUnreadCount()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  // Measured after layout rather than on click: the top bar wraps on narrow
  // viewports, so where the bell is depends on a layout pass that has not
  // happened yet when the click handler runs.
  useLayoutEffect(() => {
    if (!open) return

    const measure = () => setAnchor(buttonRef.current?.getBoundingClientRect() ?? null)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={open}
        title="Notifications"
        data-active={open}
        className="btn btn-ghost btn-icon btn-sm relative text-neutral-500 data-[active=true]:text-neutral-900"
      >
        <Icon name="bell" size={16} />
        {unread > 0 && (
          <span
            // aria-hidden: the count is already in the button's label, and a
            // screen reader announcing "3" on its own says nothing useful.
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold leading-none text-white"
          >
            {badgeLabel(unread)}
          </span>
        )}
      </button>

      {open && anchor && <NotificationsInbox anchor={anchor} onClose={onClose} />}
    </>
  )
}
