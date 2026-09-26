import type { NotificationKind, NotificationRead } from '@/api/generated/models'
import { i18n } from '@/i18n'
import { formatNumber } from '@/i18n/format'
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
}

/** "Sam mentioned you" — the line above the issue title. */
export function describe(notification: NotificationRead): string {
  // Null actor is reserved for things no person did: a Jira import, and
  // whatever automation lands later. "Someone" is wrong for those, and the
  // bare verb reads correctly for all of them.
  const who = notification.actor?.full_name
  const kind = notification.kind
  return who
    ? i18n.t(`notifications:kinds.${kind}.byActor`, { actor: who })
    : i18n.t(`notifications:kinds.${kind}.noActor`)
}

/** What the badge shows. Past 9 the exact number stops being actionable. */
export function badgeLabel(unread: number): string {
  return unread > 9
    ? i18n.t('notifications:bell.badgeOverflow', { max: formatNumber(9) })
    : formatNumber(unread)
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
