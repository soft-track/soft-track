import type { Edit } from '@/markdown/format'

/**
 * Make an edit to a textarea the way typing makes one, so ⌘Z can take it back.
 *
 * Handing a new string to a controlled textarea -- what calling `onChange`
 * with it amounts to -- assigns `value`, and assigning `value` clears the
 * browser's undo history: ⌘Z afterwards does nothing, or jumps back past
 * everything since. The mention menu and paste-to-upload did exactly that
 * before the toolbar (#118).
 *
 * `execCommand('insertText')` goes through the browser's editing instead:
 * the replacement is one undo step, and the textarea fires an ordinary
 * `input` event, which React reads like a keystroke and passes to onChange.
 * It is marked deprecated, but nothing else inserts text undoably. Where it
 * is missing or declines -- jsdom has no execCommand at all -- the text goes
 * in with setRangeText and the same event, which keeps the value right and
 * gives up only the undo step.
 */
export function applyEdit(textarea: HTMLTextAreaElement, edit: Edit) {
  textarea.focus()
  textarea.setSelectionRange(edit.from, edit.to)
  if (!insertText(edit.insert, edit.from < edit.to)) {
    textarea.setRangeText(edit.insert, edit.from, edit.to, 'end')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }
  textarea.setSelectionRange(edit.selection[0], edit.selection[1])
}

/** Replace the current selection through the editing commands; false if they are unavailable. */
function insertText(text: string, replacing: boolean): boolean {
  if (typeof document.execCommand !== 'function') return false
  try {
    // An empty insertText is not a reliable delete in every browser.
    if (text === '') return replacing ? document.execCommand('delete') : true
    return document.execCommand('insertText', false, text)
  } catch {
    return false
  }
}
