import { i18n } from '@/i18n'
import type { shortcuts as catalog } from '@/i18n/en/keyboard/shortcuts'

/**
 * The shortcut table.
 *
 * One place, because it is both what the handlers dispatch on and what the
 * cheatsheet renders. A shortcut that works but is not listed may as well not
 * exist, and a listed one that does not work is worse -- keeping them in one
 * array makes both failures impossible.
 */
export type ShortcutGroup = {
  readonly title: string
  shortcuts: Array<{ keys: string[]; readonly description: string }>
}

// Titles and descriptions are getters over the catalog (#106), so the
// cheatsheet reads the current language; the key glyphs stay here.
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  group('anywhere', [
    shortcut(['⌘', 'K'], 'openPalette'),
    shortcut(['C'], 'createIssue'),
    shortcut(['/'], 'focusSearch'),
    shortcut(['?'], 'showList'),
    shortcut(['Esc'], 'closeTop'),
  ]),
  group('board', [
    shortcut(['←', '→'], 'moveColumns'),
    shortcut(['↑', '↓'], 'moveCards'),
    shortcut(['Enter'], 'openFocused'),
    shortcut(['Space'], 'peek'),
    shortcut(['Enter'], 'openPeeked'),
    shortcut(['⇧', 'Space'], 'pickUp'),
    shortcut(['←', '→'], 'carryAcross'),
    shortcut(['↑', '↓'], 'carryWithin'),
    shortcut(['Space'], 'drop'),
    shortcut(['Esc'], 'putBack'),
    shortcut(['⌘', 'Click'], 'toggleSelected'),
    shortcut(['⇧', 'Click'], 'selectRange'),
    shortcut(['Esc'], 'clearSelection'),
  ]),
  group('issue', [
    shortcut(['S'], 'changeStatus'),
    shortcut(['P'], 'changePriority'),
    shortcut(['A'], 'changeAssignee'),
    shortcut(['L'], 'jumpToLabels'),
  ]),
]

function group(
  key: keyof (typeof catalog)['groups'],
  shortcuts: ShortcutGroup['shortcuts'],
): ShortcutGroup {
  return {
    get title() {
      return i18n.t(`keyboard:shortcuts.groups.${key}`)
    },
    shortcuts,
  }
}

function shortcut(keys: string[], key: keyof (typeof catalog)['descriptions']) {
  return {
    keys,
    get description() {
      return i18n.t(`keyboard:shortcuts.descriptions.${key}`)
    },
  }
}

/** The modifier label for this platform, for display only. */
export const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl'
