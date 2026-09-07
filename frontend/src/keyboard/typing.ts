/**
 * Whether a keystroke is going into something the user is typing in.
 *
 * Every single-key shortcut has to check this first. Without it, typing an
 * issue title containing "c" fires "create issue", and the feature makes the
 * app unusable rather than faster -- which is the classic way keyboard
 * shortcuts get added and then quietly disabled again.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true

  // A composed widget can put the caret in a descendant of the field.
  return target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

/** True for a plain key press with no modifier held. */
export function isPlainKey(event: KeyboardEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey
}
