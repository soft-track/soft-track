/**
 * Toggling a task-list checkbox writes back to the markdown source.
 *
 * The rendered checkbox knows where its list item started in the source (hast
 * carries positions), so flipping is a surgical edit at that offset rather
 * than a re-serialisation of the parsed tree. That matters: round-tripping
 * markdown through a parser normalises things the author chose on purpose --
 * bullet characters, indentation, hard line breaks, trailing spaces. Editing
 * the source in place leaves every byte the user typed exactly where it was
 * except the one character being toggled.
 */

/** The `[ ]` / `[x]` marker at or just after `offset`, if it is on that line. */
function findMarker(source: string, offset: number): { index: number; checked: boolean } | null {
  if (offset < 0 || offset >= source.length) return null

  const lineEnd = source.indexOf('\n', offset)
  const line = source.slice(offset, lineEnd === -1 ? source.length : lineEnd)

  // A task marker follows the list bullet: "- [ ] text". Anchor on that shape
  // so a literal "[x]" elsewhere in the line is never mistaken for one.
  const match = /^(\s*[-*+]\s+|\s*\d+[.)]\s+)?\[([ xX])\]/.exec(line)
  if (!match) return null

  const markerIndex = offset + match[0].length - 3
  return { index: markerIndex, checked: match[2] !== ' ' }
}

/**
 * Return `source` with the task checkbox at `offset` flipped, or `null` if
 * there is no checkbox there -- in which case the caller should do nothing
 * rather than write a guess back to the server.
 */
export function toggleTaskAtOffset(source: string, offset: number): string | null {
  const marker = findMarker(source, offset)
  if (!marker) return null

  const next = marker.checked ? ' ' : 'x'
  return source.slice(0, marker.index + 1) + next + source.slice(marker.index + 2)
}

/** Whether `source` contains at least one task-list item. */
export function hasTaskList(source: string): boolean {
  return /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/m.test(source)
}

/** `{done, total}` for the task lists in `source`, for a progress summary. */
export function taskProgress(source: string): { done: number; total: number } {
  const items = source.match(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/gm) ?? []
  return {
    done: items.filter((item) => !item.endsWith('[ ]')).length,
    total: items.length,
  }
}
