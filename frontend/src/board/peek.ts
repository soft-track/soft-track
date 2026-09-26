/**
 * The quick peek's arithmetic (#113): where it goes, and what of the
 * description it shows. Pure, so it is tested without a browser.
 */

/**
 * How long the pointer rests on a card before the peek opens.
 *
 * The whole design. Any faster and the board flickers with peeks as the
 * pointer merely crosses it on the way somewhere else.
 */
export const PEEK_DELAY_MS = 400

export type Box = { left: number; top: number; right: number; bottom: number }
export type Size = { width: number; height: number }
export type PeekSide = 'right' | 'left' | 'below' | 'above'

/**
 * Where to put a peek of `size` next to the card at `anchor`.
 *
 * Beside the card first -- right, then left when the card is near the right
 * edge -- and below or above only when neither side has room, as for a list
 * row that spans the whole width. It never covers the card it describes: a
 * side placement is clear of it horizontally and a vertical one vertically,
 * and the clamping that keeps it on screen only slides it along the card.
 * With no room anywhere, the side with the most space wins and the peek is
 * clamped into the viewport.
 */
export function placePeek(
  anchor: Box,
  size: Size,
  viewport: Size,
  { gap = 8, margin = 8 }: { gap?: number; margin?: number } = {},
): { left: number; top: number; side: PeekSide } {
  const clamp = (value: number, low: number, high: number) =>
    Math.min(Math.max(value, low), Math.max(low, high))
  const alongTop = clamp(anchor.top, margin, viewport.height - margin - size.height)
  const alongLeft = clamp(anchor.left, margin, viewport.width - margin - size.width)

  const room: Record<PeekSide, number> = {
    right: viewport.width - margin - (anchor.right + gap),
    left: anchor.left - gap - margin,
    below: viewport.height - margin - (anchor.bottom + gap),
    above: anchor.top - gap - margin,
  }
  const place = (side: PeekSide) => {
    switch (side) {
      case 'right':
        return { side, left: anchor.right + gap, top: alongTop }
      case 'left':
        return { side, left: anchor.left - gap - size.width, top: alongTop }
      case 'below':
        return { side, left: alongLeft, top: anchor.bottom + gap }
      case 'above':
        return { side, left: alongLeft, top: anchor.top - gap - size.height }
    }
  }

  const order: PeekSide[] = ['right', 'left', 'below', 'above']
  const needs = (side: PeekSide) =>
    side === 'right' || side === 'left' ? size.width : size.height
  const fits = order.find((side) => room[side] >= needs(side))
  if (fits) return place(fits)

  const roomiest = order.reduce((best, side) => (room[side] > room[best] ? side : best))
  const fallback = place(roomiest)
  return {
    side: roomiest,
    left: clamp(fallback.left, margin, viewport.width - margin - size.width),
    top: clamp(fallback.top, margin, viewport.height - margin - size.height),
  }
}

/**
 * The first lines of a description, as plain text.
 *
 * Not rendered: the markdown renderer is loaded lazily, and a peek that
 * fetched it would no longer be a peek (#113). So the syntax that would
 * read as noise -- images, link targets, heading and list markers, task
 * boxes, emphasis -- is taken out, and the words stay as written.
 */
export function plainExcerpt(markdown: string | null | undefined, maxLines = 4): string {
  if (!markdown) return ''
  const lines: string[] = []
  let fenced = false
  for (const raw of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced
      continue
    }
    let line = raw
    if (!fenced) {
      line = line
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2')
        .replace(/`([^`]*)`/g, '$1')
    }
    line = line.trim()
    if (!line) continue
    lines.push(line)
    if (lines.length === maxLines) break
  }
  return lines.join('\n')
}
