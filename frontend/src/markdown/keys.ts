import { MOD_KEY } from '@/keyboard/shortcuts'
import type { Command } from '@/markdown/format'

/**
 * The editor's own keys (#118): ⌘B, ⌘I and ⌘K, plus Tab and Shift+Tab in a
 * list. The cheatsheet lists them too, under "While writing".
 */
const LETTERS: Partial<Record<Command, string>> = { bold: 'B', italic: 'I', link: 'K' }

const MAC = MOD_KEY === '⌘'

/** How a command's shortcut is written on this platform -- "⌘B", "Ctrl+B", "Tab" -- if it has one. */
export function shortcutLabel(command: Command): string | undefined {
  const letter = LETTERS[command]
  if (letter) return MAC ? `⌘${letter}` : `Ctrl+${letter}`
  if (command === 'indent') return 'Tab'
  if (command === 'outdent') return '⇧Tab'
  return undefined
}

/** The same shortcut, spelled for `aria-keyshortcuts`. */
export function ariaShortcut(command: Command): string | undefined {
  const letter = LETTERS[command]
  if (letter) return MAC ? `Meta+${letter}` : `Control+${letter}`
  if (command === 'indent') return 'Tab'
  if (command === 'outdent') return 'Shift+Tab'
  return undefined
}

/**
 * The command a key press is the shortcut for, if any.
 *
 * On a Mac only ⌘ counts: Ctrl+B and Ctrl+K already mean something in every
 * text field there (back one character, delete to the end of the line). The
 * letter comes from `key` where that is a Latin letter, and from the physical
 * key otherwise, so the shortcuts still work on a Cyrillic or Greek layout.
 */
export function commandForKey(event: {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): Command | null {
  if (event.altKey || event.shiftKey) return null
  const modifier = MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!modifier) return null
  const letter = /^[a-z]$/i.test(event.key)
    ? event.key.toUpperCase()
    : event.code.startsWith('Key')
      ? event.code.slice(3)
      : ''
  const found = Object.entries(LETTERS).find(([, value]) => value === letter)
  return found ? (found[0] as Command) : null
}
