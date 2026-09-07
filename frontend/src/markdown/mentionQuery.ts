/** The `@query` being typed immediately before the caret, if any. */
export function mentionQueryAt(
  value: string,
  caret: number,
): { query: string; start: number } | null {
  const upToCaret = value.slice(0, caret)
  // An `@` that starts a word, followed by no whitespace. Bailing out on the
  // second `@` of an email address keeps the menu closed while someone is
  // simply typing an address into a comment.
  const match = /(^|[^\w@/])@([a-z0-9._@-]*)$/i.exec(upToCaret)
  if (!match) return null
  return { query: match[2], start: caret - match[2].length - 1 }
}
