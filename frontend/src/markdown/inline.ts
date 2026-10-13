/**
 * Where the inline markdown on one line starts and ends: emphasis, strong,
 * strikethrough, code spans and links.
 *
 * The formatting toolbar (#118) has to know whether the selection is already
 * bold before it can choose between wrapping and unwrapping, and "there is a
 * `**` somewhere on each side" is not an answer: in `**a** b **c**` the `b`
 * has markers on both sides and is not bold. So this pairs delimiters the way
 * CommonMark does -- code spans first, then links, then emphasis by its
 * delimiter-run rules, with GFM's `~` alongside -- on a single line, which is
 * all a toolbar edit ever looks at.
 *
 * It is not a renderer and never has to agree with one byte for byte:
 * react-markdown still decides what the text looks like. What it must not do
 * is call plain text formatted, because then a button would strip markers
 * that were never markers.
 */

export type SpanKind = 'strong' | 'emphasis' | 'strike' | 'code' | 'link' | 'image'

export type Span = {
  kind: SpanKind
  /** Offsets into the line, markers included. */
  start: number
  end: number
  /** Between the markers. For a code span, inside its padding spaces too. */
  contentStart: number
  contentEnd: number
}

/** A run of `*`, `_` or `~`, and how much of it is still unpaired: `[lo, hi)`. */
type Run = {
  char: string
  length: number
  lo: number
  hi: number
  canOpen: boolean
  canClose: boolean
  /** The link whose text holds the run, or -1: emphasis never pairs across a link's edge. */
  scope: number
}

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/
const PUNCTUATION = /[\p{P}\p{S}]/u
const WHITESPACE = /\s/

/** Every span on `line`, by where it starts; the outer one first when two start together. */
export function inlineSpans(line: string): Span[] {
  const spans: Span[] = []
  // Positions that can never be a delimiter: escaped characters, code, and
  // the `](destination)` half of a link.
  const literal = new Uint8Array(line.length)

  findCodeSpans(line, literal, spans)
  const links = findLinks(line, literal)
  spans.push(...links)
  pairEmphasis(line, literal, links, spans)

  return spans.sort((a, b) => a.start - b.start || b.end - a.end)
}

/**
 * Backslash escapes and code spans, in one pass because each decides the
 * other: `` \` `` cannot open a code span, and inside one a backslash is just
 * a backslash.
 */
function findCodeSpans(line: string, literal: Uint8Array, spans: Span[]) {
  let i = 0
  while (i < line.length) {
    const char = line[i]
    if (char === '\\' && i + 1 < line.length && ASCII_PUNCTUATION.test(line[i + 1])) {
      literal[i] = 1
      literal[i + 1] = 1
      i += 2
      continue
    }
    if (char !== '`') {
      i += 1
      continue
    }

    const length = runLength(line, i, '`')
    const close = findBacktickRun(line, i + length, length)
    if (close === -1) {
      // An opener with no partner is text, and so is everything after it.
      literal.fill(1, i, i + length)
      i += length
      continue
    }

    let contentStart = i + length
    let contentEnd = close
    // CommonMark drops one space from each end when both are there, so that
    // `` `` `a` `` `` can hold a backtick at its edge.
    const inner = line.slice(contentStart, contentEnd)
    if (inner.length > 1 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() !== '') {
      contentStart += 1
      contentEnd -= 1
    }
    spans.push({ kind: 'code', start: i, end: close + length, contentStart, contentEnd })
    literal.fill(1, i, close + length)
    i = close + length
  }
}

function runLength(line: string, at: number, char: string): number {
  let length = 0
  while (line[at + length] === char) length += 1
  return length
}

/** The next run of exactly `length` backticks from `from`, or -1. */
function findBacktickRun(line: string, from: number, length: number): number {
  let j = from
  while (j < line.length) {
    if (line[j] !== '`') {
      j += 1
      continue
    }
    const run = runLength(line, j, '`')
    if (run === length) return j
    j += run
  }
  return -1
}

/** `[text](destination)` and `![alt](source)`. Reference links are not something a toolbar writes. */
function findLinks(line: string, literal: Uint8Array): Span[] {
  const links: Span[] = []
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== '[' || literal[i]) continue

    let depth = 0
    let textEnd = -1
    for (let j = i; j < line.length; j += 1) {
      if (literal[j]) continue
      if (line[j] === '[') depth += 1
      else if (line[j] === ']' && --depth === 0) {
        textEnd = j
        break
      }
    }
    if (textEnd === -1 || line[textEnd + 1] !== '(') continue

    let parens = 0
    let close = -1
    for (let j = textEnd + 1; j < line.length; j += 1) {
      if (line[j] === '\\' && ASCII_PUNCTUATION.test(line[j + 1] ?? '')) {
        j += 1
      } else if (line[j] === '(') {
        parens += 1
      } else if (line[j] === ')' && --parens === 0) {
        close = j
        break
      }
    }
    if (close === -1) continue

    const image = i > 0 && line[i - 1] === '!' && !literal[i - 1]
    const start = image ? i - 1 : i
    links.push({
      kind: image ? 'image' : 'link',
      start,
      end: close + 1,
      contentStart: i + 1,
      contentEnd: textEnd,
    })
    literal.fill(1, start, i + 1)
    literal.fill(1, textEnd, close + 1)
    i = close
  }
  return links
}

/**
 * `*`, `_` and `~` runs, paired by CommonMark's "process emphasis": each
 * closer takes the nearest opener of the same character that the rule of
 * three allows, strong when both sides have two to give. GFM's tildes pair
 * only with a run of the same length, and three or more are not a delimiter.
 */
function pairEmphasis(line: string, literal: Uint8Array, links: Span[], spans: Span[]) {
  const runs: Run[] = []
  let i = 0
  while (i < line.length) {
    const char = line[i]
    if ((char !== '*' && char !== '_' && char !== '~') || literal[i]) {
      i += 1
      continue
    }
    let length = 1
    while (i + length < line.length && line[i + length] === char && !literal[i + length]) length += 1

    if (!(char === '~' && length > 2)) {
      const { left, right, before, after } = flanking(line, i, i + length)
      runs.push({
        char,
        length,
        lo: i,
        hi: i + length,
        canOpen: char === '_' ? left && (!right || before) : left,
        canClose: char === '_' ? right && (!left || after) : right,
        scope: links.findIndex((link) => link.contentStart <= i && i < link.contentEnd),
      })
    }
    i += length
  }

  const scopes = new Set(runs.map((run) => run.scope))
  for (const scope of scopes) {
    pairRuns(
      runs.filter((run) => run.scope === scope),
      spans,
    )
  }
}

/**
 * Left- and right-flanking, as CommonMark defines them, plus whether the
 * characters either side are punctuation (which `_` also needs). The edges
 * of the line count as whitespace.
 */
function flanking(line: string, start: number, end: number) {
  const prev = start === 0 ? ' ' : line[start - 1]
  const next = end >= line.length ? ' ' : line[end]
  const prevSpace = WHITESPACE.test(prev)
  const nextSpace = WHITESPACE.test(next)
  const before = PUNCTUATION.test(prev)
  const after = PUNCTUATION.test(next)
  return {
    left: !nextSpace && (!after || prevSpace || before),
    right: !prevSpace && (!before || nextSpace || after),
    before,
    after,
  }
}

function pairRuns(runs: Run[], spans: Span[]) {
  for (let c = 0; c < runs.length; c += 1) {
    const closer = runs[c]
    if (!closer.canClose) continue

    while (closer.hi > closer.lo) {
      let o = c - 1
      for (; o >= 0; o -= 1) {
        const opener = runs[o]
        if (opener.hi <= opener.lo || !opener.canOpen || opener.char !== closer.char) continue
        if (closer.char === '~') {
          if (opener.hi - opener.lo === closer.hi - closer.lo) break
          continue
        }
        const ruleOfThree =
          (opener.canClose || closer.canOpen) &&
          (opener.length + closer.length) % 3 === 0 &&
          !(opener.length % 3 === 0 && closer.length % 3 === 0)
        if (!ruleOfThree) break
      }
      if (o < 0) break

      const opener = runs[o]
      const use =
        closer.char === '~'
          ? closer.hi - closer.lo
          : Math.min(2, opener.hi - opener.lo, closer.hi - closer.lo)
      const contentStart = opener.hi
      opener.hi -= use
      const contentEnd = closer.lo
      closer.lo += use
      spans.push({
        kind: closer.char === '~' ? 'strike' : use === 2 ? 'strong' : 'emphasis',
        start: opener.hi,
        end: closer.lo,
        contentStart,
        contentEnd,
      })
      // Whatever sat between the two is text now: nothing inside a pair can
      // pair with something outside it.
      for (let k = o + 1; k < c; k += 1) runs[k].hi = runs[k].lo
    }
  }
}
