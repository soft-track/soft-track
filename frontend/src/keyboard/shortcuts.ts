/**
 * The shortcut table.
 *
 * One place, because it is both what the handlers dispatch on and what the
 * cheatsheet renders. A shortcut that works but is not listed may as well not
 * exist, and a listed one that does not work is worse -- keeping them in one
 * array makes both failures impossible.
 */
export type ShortcutGroup = {
  title: string
  shortcuts: Array<{ keys: string[]; description: string }>
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Anywhere',
    shortcuts: [
      { keys: ['⌘', 'K'], description: 'Open the command palette' },
      { keys: ['C'], description: 'Create an issue' },
      { keys: ['/'], description: 'Focus search' },
      { keys: ['?'], description: 'Show this list' },
      { keys: ['Esc'], description: 'Close whatever is open' },
    ],
  },
  {
    title: 'On the board',
    shortcuts: [
      { keys: ['←', '→'], description: 'Move between columns' },
      { keys: ['↑', '↓'], description: 'Move between cards' },
      { keys: ['Enter'], description: 'Open the focused issue' },
    ],
  },
  {
    title: 'On an open issue',
    shortcuts: [
      { keys: ['S'], description: 'Change status' },
      { keys: ['P'], description: 'Change priority' },
      { keys: ['A'], description: 'Change assignee' },
      { keys: ['L'], description: 'Jump to labels' },
    ],
  },
]

/** The modifier label for this platform, for display only. */
export const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl'
