/**
 * The lines of a retrospective's "what to change" (#271), each a candidate
 * for a ticket: one per line of the markdown, without its list marker or
 * task box, blank lines dropped. The text is what an action is matched by,
 * so it is trimmed the way the API trims it.
 */
export function actionLines(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
        .replace(/^\[[ xX]\]\s+/, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
}
