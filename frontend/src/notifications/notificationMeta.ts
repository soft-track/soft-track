import type { NotificationKind, NotificationRead } from '@/api/generated/models'
import { i18n } from '@/i18n'
import { formatDate, formatNumber } from '@/i18n/format'
import type { IconName } from '@/ui/Icon'

/**
 * How each kind of notification reads in the inbox.
 *
 * The sentence is built here rather than sent by the API so that the backend
 * has one job -- record who should be told what -- and the wording stays with
 * the rest of the interface's copy. The digest email has its own phrasing in
 * `lib_softtrack/digest.py` for the same reason: it is a different medium and
 * a different sentence ("assigned ENG-4 to you", not "assigned this to you").
 *
 * The sentences themselves are in the catalog (#106), `notifications:kinds`,
 * each whole -- with the person in it, and without -- rather than a verb
 * glued after a name.
 */
export const KIND_META: Record<NotificationKind, { icon: IconName; color: string }> = {
  assigned: { icon: 'users', color: 'var(--color-accent-sky)' },
  mentioned: { icon: 'sparkle', color: 'var(--color-accent-pink)' },
  commented: { icon: 'mail', color: 'var(--color-neutral-400)' },
  status_changed: { icon: 'board', color: 'var(--color-accent-amber)' },
  // Assignment by another name (#117): set as a ticket's reviewer, say.
  field_assigned: { icon: 'user', color: 'var(--color-accent-sky)' },
  // The two that come from a date rather than a person (#262).
  due_tomorrow: { icon: 'calendar', color: 'var(--color-brand-500)' },
  overdue: { icon: 'flag', color: 'var(--color-brand-500)' },
}

/** The kinds nobody did: a due date reminding (#262). */
export function isReminder(notification: NotificationRead): boolean {
  return notification.kind === 'due_tomorrow' || notification.kind === 'overdue'
}

/** The second overdue reminder, a week after the first: "Still overdue". */
function stillOverdue(notification: NotificationRead): boolean {
  if (notification.kind !== 'overdue' || !notification.due_date) return false
  const due = Date.parse(`${notification.due_date}T00:00:00Z`)
  const sent = Date.parse(notification.created_at.slice(0, 10) + 'T00:00:00Z')
  return sent - due >= 8 * 24 * 60 * 60 * 1000
}

/** A due date as the inbox writes it: "4 Oct". A date, so no timezone moves it. */
function dueDay(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return formatDate(new Date(year, month - 1, day), 'd MMM')
}

/**
 * The line under a reminder's ticket: "Due 4 Oct, and assigned to you." or
 * "Was due 29 Sep." Null for everything else.
 */
export function reminderDetail(notification: NotificationRead): string | null {
  if (!isReminder(notification) || !notification.due_date) return null
  const date = dueDay(notification.due_date)
  if (notification.kind === 'overdue') {
    return i18n.t('notifications:kinds.overdue.detail', { date })
  }
  return notification.assigned_to_you
    ? i18n.t('notifications:kinds.due_tomorrow.detailAssigned', { date })
    : i18n.t('notifications:kinds.due_tomorrow.detail', { date })
}

/** "Sam mentioned you" — the line above the ticket title. */
export function describe(notification: NotificationRead): string {
  // Null actor is reserved for things no person did: a Jira import, and
  // whatever automation lands later. "Someone" is wrong for those, and the
  // bare verb reads correctly for all of them.
  const who = notification.actor?.full_name
  const kind = notification.kind
  // The field someone was named in, for `field_assigned`; the others ignore it.
  const field = notification.field_name ?? ''
  if (stillOverdue(notification)) return i18n.t('notifications:kinds.overdue.again')
  return who
    ? i18n.t(`notifications:kinds.${kind}.byActor`, { actor: who, field })
    : i18n.t(`notifications:kinds.${kind}.noActor`, { field })
}

/** What the badge shows. Past 9 the exact number stops being actionable. */
export function badgeLabel(unread: number): string {
  return unread > 9
    ? i18n.t('notifications:bell.badgeOverflow', { max: formatNumber(9) })
    : formatNumber(unread)
}

/**
 * What a screen reader hears when the count changes. Empty at zero: nothing
 * arriving is not news, and an empty live region announces nothing.
 *
 * The exact count, not badgeLabel's `9+` cap, which exists only for the
 * badge's width -- so this is deliberately not routed through badgeLabel.
 */
export function unreadAnnouncement(unread: number): string {
  if (unread === 0) return ''
  return i18n.t('notifications:bell.announce', { count: unread, n: formatNumber(unread) })
}

/** Between a floating panel and the control it hangs from, and the viewport. */
const GAP = 8

/** Narrower than this and the inbox's rows stop being readable. */
const MIN_PANEL_WIDTH = 320

/**
 * Where to pin the inbox, given where the bell ended up.
 *
 * Right-aligned to the bell, because that is what a dropdown looks like --
 * except when doing so would squeeze it. On a phone the top bar wraps and the
 * bell sits well left of the screen edge, so aligning to it pushed the panel's
 * left edge off the viewport entirely. There, the space to the right of the
 * bell is worth more than the alignment.
 */
export function panelPosition(anchor: DOMRect, viewportWidth: number) {
  const alignedToBell = Math.max(GAP, viewportWidth - anchor.right)
  const right =
    viewportWidth - alignedToBell - GAP < MIN_PANEL_WIDTH ? GAP : alignedToBell
  return { top: anchor.bottom + GAP, right, maxWidth: viewportWidth - right - GAP }
}
