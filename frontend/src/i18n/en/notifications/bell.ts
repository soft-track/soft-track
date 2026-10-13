/** The bell in the top bar and its unread badge. */
export const bell = {
  label: 'Notifications',
  labelUnread_one: 'Notifications ({{count}} unread)',
  labelUnread_other: 'Notifications ({{count}} unread)',
  badgeOverflow: '{{max}}+',
  /** Read out by the hidden live region when the count changes (#77). */
  announce_one: '{{n}} unread notification',
  announce_other: '{{n}} unread notifications',
} as const
