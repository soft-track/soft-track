export const MIN_WORDS_TO_SUGGEST = 3
export const MAX_SUGGESTIONS = 3

/** Counts words. Falls back to Intl.Segmenter for scripts with no spaces
 *  (CJK etc.), so the gate isn't silently disabled for those titles. */
export function wordCount(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return 0
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
    let count = 0
    for (const { isWordLike } of segmenter.segment(trimmed)) if (isWordLike) count++
    return count
  }
  return trimmed.split(/\s+/).filter(Boolean).length
}

export function shouldShowSuggestions(title: string, dismissed: boolean): boolean {
  return !dismissed && wordCount(title) >= MIN_WORDS_TO_SUGGEST
}

/** Search ANDs every term server-side, so a longer title matches less, not
 *  more. Freezing the query at the trigger width keeps later detail words
 *  from suppressing matches on the subject. */
export function getSearchPhrase(title: string, maxWords: number = MIN_WORDS_TO_SUGGEST): string {
  return title.trim().split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ')
}