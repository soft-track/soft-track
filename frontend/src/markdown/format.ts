import { type Span, type SpanKind, inlineSpans } from '@/markdown/inline'

/**
 * What the formatting toolbar's buttons do to the text (#118).
 *
 * Every command is a pure function from the text and its selection to one
 * edit, so all of it is testable without a browser. The textarea stays the
 * source of truth: nothing here parses a document into a tree and prints it
 * back, which would reformat whatever the author typed. A command changes the
 * markers it is about and leaves every other byte where it was -- the same
 * promise `toggleTaskAtOffset` makes for checkboxes.
 *
 * The rules the buttons follow, so they can be checked against:
 * - A button on formatting that is already there takes it off: bold on bold
 *   text unwraps it, a list button on a list removes the markers.
 * - Wrapping keeps the selection on the text, inside the new markers, so a
 *   second press finds it and unwraps.
 * - With nothing selected, an inline button writes a placeholder and selects
 *   it, so typing replaces it -- unless the caret is inside that formatting,
 *   in which case it comes off.
 * - Line buttons act on every line the selection touches.
 */

/** The text and the selection in it, as a textarea has them. */
export type TextState = { value: string; start: number; end: number }

/**
 * One contiguous replacement, and the selection to leave behind.
 *
 * A command may change several places -- both ends of a bold span, the start
 * of every line in a list -- but it arrives as one replacement from the first
 * change to the last, so that applying it is one step on the browser's undo
 * stack (see `applyEdit`). `from` and `to` are offsets before the edit;
 * `selection` is after it.
 */
export type Edit = { from: number; to: number; insert: string; selection: readonly [number, number] }

/** What an inline button writes when there is nothing selected for it to format. */
export type Placeholders = {
  bold: string
  italic: string
  strikethrough: string
  code: string
  linkText: string
  url: string
}

export type Command =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code'
  | 'link'
  | 'heading'
  | 'bulletList'
  | 'numberedList'
  | 'checklist'
  | 'quote'
  | 'codeBlock'
  | 'indent'
  | 'outdent'
  | 'clear'

/** What the selection already has, for the toolbar's pressed buttons. */
export type Formats = {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  code: boolean
  link: boolean
  /** The caret line's heading level, 0 for normal text. */
  heading: number
  bulletList: boolean
  numberedList: boolean
  checklist: boolean
  quote: boolean
  codeBlock: boolean
  /** Whether indent and outdent have anything to act on. */
  list: boolean
}

type InlineKind = 'strong' | 'emphasis' | 'strike' | 'code'

const MARKERS: Record<Exclude<InlineKind, 'code'>, string> = {
  strong: '**',
  emphasis: '*',
  strike: '~~',
}

const URL_LIKE = /^(?:https?:\/\/|mailto:)\S+$/i
const WHITESPACE = /\s/

export function runCommand(command: Command, state: TextState, placeholders: Placeholders): Edit | null {
  const clamped = clamp(state)
  switch (command) {
    case 'bold':
      return toggleInline(clamped, 'strong', placeholders.bold)
    case 'italic':
      return toggleInline(clamped, 'emphasis', placeholders.italic)
    case 'strikethrough':
      return toggleInline(clamped, 'strike', placeholders.strikethrough)
    case 'code':
      return toggleInline(clamped, 'code', placeholders.code)
    case 'link':
      return toggleLink(clamped, placeholders)
    case 'heading':
      return toggleHeading(clamped)
    case 'bulletList':
      return toggleList(clamped, 'bullet')
    case 'numberedList':
      return toggleList(clamped, 'ordered')
    case 'checklist':
      return toggleList(clamped, 'task')
    case 'quote':
      return toggleQuote(clamped)
    case 'codeBlock':
      return toggleCodeBlock(clamped)
    case 'indent':
      return shiftList(clamped, 1)
    case 'outdent':
      return shiftList(clamped, -1)
    case 'clear':
      return clearFormatting(clamped)
  }
}

/** Make every line the selection touches a heading of `level`, or normal text for 0. */
export function setHeading(state: TextState, level: number): Edit | null {
  const { value, start, end } = clamp(state)
  const changes = targetLines(value, start, end).map((line) => {
    const s = structure(line.text)
    const at = line.start + s.quote.length + s.indent.length + s.marker.length + s.task.length
    return { from: at, to: at + s.heading.length, insert: level > 0 ? `${'#'.repeat(level)} ` : '' }
  })
  return commit(value, changes, [start, end], [1, 1])
}

export function formatsAt(state: TextState): Formats {
  const { value, start, end } = clamp(state)
  const touched = touchedLines(value, start, end)
  const codeBlock = insideCodeBlock(value, start, touched.length)
  const targets = targetLines(value, start, end).map((line) => structure(line.text))

  const segs = selectionSegments(value, start, end).map((seg) => ({
    ...seg,
    spans: inlineSpans(seg.line.text),
  }))
  const caretLine = lineAt(value, end)
  const caretSpans = segs.length === 0 ? inlineSpans(caretLine.text) : []
  const has = (kind: SpanKind) => {
    if (codeBlock) return false
    if (segs.length === 0) {
      const caret = end - caretLine.start
      return enclosing(caretSpans, kind, caret, caret) !== undefined
    }
    return segs.every((seg) => enclosing(seg.spans, kind, seg.from, seg.to) !== undefined)
  }

  return {
    bold: has('strong'),
    italic: has('emphasis'),
    strikethrough: has('strike'),
    code: has('code'),
    link: has('link'),
    heading: codeBlock ? 0 : headingLevel(structure(lineAt(value, start).text)),
    bulletList: !codeBlock && targets.every((s) => s.list === 'bullet' && s.task === ''),
    numberedList: !codeBlock && targets.every((s) => s.list === 'ordered'),
    checklist: !codeBlock && targets.every((s) => s.task !== ''),
    quote: !codeBlock && targets.every((s) => s.quote !== ''),
    codeBlock,
    list: !codeBlock && touched.some((line) => structure(line.text).list !== null),
  }
}

function clamp({ value, start, end }: TextState): TextState {
  const a = Math.max(0, Math.min(start, value.length))
  const b = Math.max(0, Math.min(end, value.length))
  return { value, start: Math.min(a, b), end: Math.max(a, b) }
}

// -- Changes ------------------------------------------------------------------

type Change = { from: number; to: number; insert: string }

/**
 * Several changes as one `Edit`, with the selection carried through them.
 *
 * `bias` says, for each end of the selection, which side of an insertion
 * made exactly where it sits it should land on: -1 before, 1 after.
 */
function commit(
  value: string,
  changes: Array<Change | null>,
  [start, end]: [number, number],
  bias: [number, number],
): Edit | null {
  const real = changes
    .filter((change): change is Change => change !== null)
    .filter((change) => value.slice(change.from, change.to) !== change.insert)
    .sort((a, b) => a.from - b.from || a.to - b.to)
  if (real.length === 0) return null

  const from = real[0].from
  const to = Math.max(...real.map((change) => change.to))
  let insert = ''
  let cursor = from
  for (const change of real) {
    insert += value.slice(cursor, change.from) + change.insert
    cursor = change.to
  }
  insert += value.slice(cursor, to)

  return { from, to, insert, selection: [mapPosition(real, start, bias[0]), mapPosition(real, end, bias[1])] }
}

function mapPosition(changes: Change[], position: number, bias: number): number {
  let delta = 0
  for (const change of changes) {
    if (change.from > position) break
    const replacing = change.from < change.to
    if (change.to < position || (change.to === position && (replacing || bias > 0))) {
      delta += change.insert.length - (change.to - change.from)
      continue
    }
    // Inside what was replaced, or an insertion right here that it stays in front of.
    if (!replacing) return position + delta
    return change.from + delta + (bias > 0 ? change.insert.length : 0)
  }
  return position + delta
}

// -- Lines --------------------------------------------------------------------

type Line = { start: number; end: number; text: string }

function lineAt(value: string, position: number): Line {
  const start = position === 0 ? 0 : value.lastIndexOf('\n', position - 1) + 1
  const newline = value.indexOf('\n', position)
  const end = newline === -1 ? value.length : newline
  return { start, end, text: value.slice(start, end) }
}

/**
 * The lines a selection touches. A selection that ends at the very start of
 * a line -- what dragging across whole lines usually produces -- leaves that
 * line out.
 */
function touchedLines(value: string, start: number, end: number): Line[] {
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end
  const lines = [lineAt(value, start)]
  while (lines[lines.length - 1].end < last) {
    lines.push(lineAt(value, lines[lines.length - 1].end + 1))
  }
  return lines
}

/** The touched lines that have something on them, or the caret's line if none do. */
function targetLines(value: string, start: number, end: number): Line[] {
  const lines = touchedLines(value, start, end)
  const filled = lines.filter((line) => !isBlank(line.text))
  return filled.length > 0 ? filled : lines.slice(0, 1)
}

/** The block markers at the start of a line, each with the space after it. */
type Structure = {
  /** `> `, as many as it is nested, with any leading spaces. */
  quote: string
  /** Whitespace after the quote: how deep a list item is nested. */
  indent: string
  /** `- `, `* `, `1. `: the list marker and the space after it. */
  marker: string
  list: 'bullet' | 'ordered' | null
  number: number
  /** `[ ] ` or `[x] ` after a list marker. */
  task: string
  /** `## `. */
  heading: string
}

const QUOTE = /^(?: {0,3}>[ \t]?)*/
const INDENT = /^[ \t]*/
const BULLET = /^[-*+][ \t]+/
const ORDERED = /^(\d{1,9})[.)][ \t]+/
const TASK = /^\[[ xX]\][ \t]+/
const HEADING = /^#{1,6}(?:[ \t]+|$)/

function structure(text: string): Structure {
  const quote = QUOTE.exec(text)?.[0] ?? ''
  let rest = text.slice(quote.length)
  const indent = INDENT.exec(rest)?.[0] ?? ''
  rest = rest.slice(indent.length)

  let marker = ''
  let list: Structure['list'] = null
  let number = 0
  const bullet = BULLET.exec(rest)
  const ordered = ORDERED.exec(rest)
  if (bullet) {
    marker = bullet[0]
    list = 'bullet'
  } else if (ordered) {
    marker = ordered[0]
    list = 'ordered'
    number = Number(ordered[1])
  }
  rest = rest.slice(marker.length)

  const task = list ? (TASK.exec(rest)?.[0] ?? '') : ''
  rest = rest.slice(task.length)
  const heading = HEADING.exec(rest)?.[0] ?? ''
  return { quote, indent, marker, list, number, task, heading }
}

function contentOffset(s: Structure): number {
  return s.quote.length + s.indent.length + s.marker.length + s.task.length + s.heading.length
}

function headingLevel(s: Structure): number {
  return s.heading.trimEnd().length
}

/** Nothing on the line but whitespace, once any quote markers are set aside. */
function isBlank(text: string): boolean {
  return text.slice(QUOTE.exec(text)?.[0].length ?? 0).trim() === ''
}

function quoteDepth(quote: string): number {
  return quote.split('>').length - 1
}

/** How wide some leading whitespace is, a tab reaching the next multiple of four. */
function columns(whitespace: string): number {
  let width = 0
  for (const char of whitespace) width = char === '\t' ? width + 4 - (width % 4) : width + 1
  return width
}

// -- Inline formatting --------------------------------------------------------

/** One line's part of a selection: past its block markers, whitespace trimmed off both ends. */
type Segment = { line: Line; from: number; to: number }

function selectionSegments(value: string, start: number, end: number): Segment[] {
  if (start === end) return []
  return touchedLines(value, start, end).flatMap((line) => {
    let from = Math.max(start - line.start, contentOffset(structure(line.text)))
    let to = Math.min(end - line.start, line.text.length)
    // `** bold **` is not bold: the markers have to touch the text.
    while (from < to && WHITESPACE.test(line.text[from])) from += 1
    while (to > from && WHITESPACE.test(line.text[to - 1])) to -= 1
    return to > from ? [{ line, from, to }] : []
  })
}

/**
 * The innermost span of `kind` holding `[from, to]`. A caret counts from just
 * inside the opening markers to just inside the closing ones -- for a link,
 * anywhere up to its closing parenthesis, the address included. A selection
 * counts if it is anywhere within the span, markers included.
 */
function enclosing(spans: Span[], kind: SpanKind, from: number, to: number): Span | undefined {
  let found: Span | undefined
  for (const span of spans) {
    if (span.kind !== kind) continue
    const last = span.kind === 'link' ? span.end - 1 : span.contentEnd
    const inside =
      from === to
        ? span.contentStart <= from && from <= last
        : span.start <= from && to <= span.end
    if (inside && (!found || span.end - span.start < found.end - found.start)) found = span
  }
  return found
}

function unwrap(line: Line, span: Span): Change[] {
  return [
    { from: line.start + span.start, to: line.start + span.contentStart, insert: '' },
    { from: line.start + span.contentEnd, to: line.start + span.end, insert: '' },
  ]
}

/** `text` from `from` to `to`, with the markers of `spans` (all inside that range) taken out. */
function withoutMarkers(text: string, from: number, to: number, spans: Span[]): string {
  const cuts = spans
    .flatMap((span): Array<[number, number]> => [
      [span.start, span.contentStart],
      [span.contentEnd, span.end],
    ])
    .sort((a, b) => a[0] - b[0])
  let out = ''
  let cursor = from
  for (const [cutFrom, cutTo] of cuts) {
    out += text.slice(cursor, cutFrom)
    cursor = cutTo
  }
  return out + text.slice(cursor, to)
}

/**
 * The opening and closing markers for `inner`. A code span needs a fence
 * longer than any run of backticks inside it, and a space of padding when its
 * text starts or ends with one.
 */
function markersFor(kind: InlineKind, inner: string): [string, string] {
  if (kind !== 'code') return [MARKERS[kind], MARKERS[kind]]
  const longest = Math.max(0, ...(inner.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(longest + 1)
  const pad = inner.startsWith('`') || inner.endsWith('`') ? ' ' : ''
  return [fence + pad, pad + fence]
}

/**
 * Wrap one segment. Spans of the same kind inside it, or hanging over one of
 * its ends, are merged in: bolding "a **b** c" gives "**a b c**", not markers
 * nested inside markers.
 */
function wrap(seg: Segment & { spans: Span[] }, kind: InlineKind) {
  const { line, from, to, spans } = seg
  const same = spans.filter((span) => span.kind === kind && span.start < to && span.end > from)
  const a = Math.min(from, ...same.map((span) => span.start))
  const b = Math.max(to, ...same.map((span) => span.end))
  const inner = withoutMarkers(line.text, a, b, same)
  const [open, close] = markersFor(kind, inner)
  const at = line.start + a
  return {
    change: { from: at, to: line.start + b, insert: open + inner + close },
    inside: [at + open.length, at + open.length + inner.length] as const,
  }
}

function toggleInline(state: TextState, kind: InlineKind, placeholder: string): Edit | null {
  const { value, start, end } = state
  const segs = selectionSegments(value, start, end).map((seg) => ({
    ...seg,
    spans: inlineSpans(seg.line.text),
  }))

  if (segs.length === 0) {
    const line = lineAt(value, end)
    const caret = end - line.start
    const around = enclosing(inlineSpans(line.text), kind, caret, caret)
    if (around) return commit(value, unwrap(line, around), [start, end], [-1, 1])

    const [open, close] = markersFor(kind, placeholder)
    return {
      from: end,
      to: end,
      insert: open + placeholder + close,
      selection: [end + open.length, end + open.length + placeholder.length],
    }
  }

  const found = segs.map((seg) => enclosing(seg.spans, kind, seg.from, seg.to))
  const all = found.every((span) => span !== undefined)

  if (all) {
    return commit(
      value,
      segs.flatMap((seg, i) => unwrap(seg.line, found[i]!)),
      [start, end],
      [-1, 1],
    )
  }

  // One line keeps the selection on the text, inside the markers, which is
  // what the next press looks for. Across lines the selection keeps every
  // line whole, markers included, so the next press sees each one wrapped.
  if (segs.length === 1) {
    const { change, inside } = wrap(segs[0], kind)
    return { ...change, selection: inside }
  }
  return commit(
    value,
    segs.map((seg, i) => (found[i] ? null : wrap(seg, kind).change)),
    [start, end],
    [-1, 1],
  )
}

function toggleLink(state: TextState, placeholders: Placeholders): Edit | null {
  const { value, start, end } = state
  const segs = selectionSegments(value, start, end)

  if (segs.length <= 1) {
    const line = segs[0]?.line ?? lineAt(value, end)
    const from = segs[0]?.from ?? end - line.start
    const to = segs[0]?.to ?? end - line.start
    const around = enclosing(inlineSpans(line.text), 'link', from, to)
    if (around) return commit(value, unwrap(line, around), [start, end], [-1, 1])
  }

  if (segs.length === 0) {
    const { linkText, url } = placeholders
    return {
      from: end,
      to: end,
      insert: `[${linkText}](${url})`,
      selection: [end + 1, end + 1 + linkText.length],
    }
  }

  const first = segs[0]
  const last = segs[segs.length - 1]
  const from = first.line.start + first.from
  const to = last.line.start + last.to
  const text = value.slice(from, to)

  // A selected address becomes the destination, and the words are what is
  // left to type; anything else is the words, and the address is.
  if (URL_LIKE.test(text)) {
    const { linkText } = placeholders
    return { from, to, insert: `[${linkText}](${text})`, selection: [from + 1, from + 1 + linkText.length] }
  }
  const url = from + text.length + 3
  return {
    from,
    to,
    insert: `[${text}](${placeholders.url})`,
    selection: [url, url + placeholders.url.length],
  }
}

/**
 * Strip the markers of every span the selection touches, or, with nothing
 * selected, of every span around the caret. Images stay: clearing formatting
 * is not deleting a picture.
 */
function clearFormatting(state: TextState): Edit | null {
  const { value, start, end } = state
  const changes: Change[] = []
  for (const line of touchedLines(value, start, end)) {
    const from = Math.max(start, line.start) - line.start
    const to = Math.min(end, line.end) - line.start
    for (const span of inlineSpans(line.text)) {
      if (span.kind === 'image') continue
      const touches =
        start === end
          ? span.contentStart <= from && from <= span.contentEnd
          : span.start < to && span.end > from
      if (touches) changes.push(...unwrap(line, span))
    }
  }
  return commit(value, changes, [start, end], [-1, 1])
}

// -- Line formatting ----------------------------------------------------------

/** The compact toolbar's one heading button: a level-3 heading, or back to normal text. */
function toggleHeading(state: TextState): Edit | null {
  const { value, start, end } = state
  const all = targetLines(value, start, end).every((line) => structure(line.text).heading !== '')
  return setHeading(state, all ? 0 : 3)
}

function toggleList(state: TextState, kind: 'bullet' | 'ordered' | 'task'): Edit | null {
  const { value, start, end } = state
  const lines = targetLines(value, start, end)
  const structures = lines.map((line) => structure(line.text))
  const isKind = (s: Structure) =>
    kind === 'task' ? s.task !== '' : kind === 'ordered' ? s.list === 'ordered' : s.list === 'bullet' && s.task === ''
  const all = structures.every(isKind)
  let number = kind === 'ordered' ? firstNumber(value, lines[0], structures[0]) : 0

  const changes = lines.map((line, i): Change | null => {
    const s = structures[i]
    const at = line.start + s.quote.length
    const markers = s.indent.length + s.marker.length + s.task.length
    if (all) return { from: at, to: at + markers, insert: '' }

    const from = at + s.indent.length
    const bullet = s.list === 'bullet' ? s.marker.trimEnd() : '-'
    if (kind === 'ordered') {
      // A checkbox survives numbering: GFM has ordered task lists too.
      return { from, to: from + s.marker.length, insert: `${number++}. ` }
    }
    if (isKind(s)) return null
    return { from, to: at + markers, insert: kind === 'task' ? `${bullet} [ ] ` : `${bullet} ` }
  })
  return commit(value, changes, [start, end], [1, 1])
}

/** Numbering carries on from an ordered item just above at the same depth. */
function firstNumber(value: string, line: Line, s: Structure): number {
  if (line.start > 0) {
    const above = structure(lineAt(value, line.start - 1).text)
    if (above.list === 'ordered' && above.quote === s.quote && above.indent === s.indent) {
      return above.number + 1
    }
  }
  return s.list === 'ordered' ? s.number : 1
}

function toggleQuote(state: TextState): Edit | null {
  const { value, start, end } = state
  const lines = touchedLines(value, start, end)
  const all = targetLines(value, start, end).every((line) => structure(line.text).quote !== '')

  const changes = lines.map((line): Change | null => {
    const quote = /^ {0,3}>[ \t]?/.exec(line.text)
    if (all) return quote ? { from: line.start, to: line.start + quote[0].length, insert: '' } : null
    if (quote) return null
    // A bare `>` keeps a blank line inside the quote, so paragraphs stay in one block.
    const insert = lines.length > 1 && line.text.trim() === '' ? '>' : '> '
    return { from: line.start, to: line.start, insert }
  })
  return commit(value, changes, [start, end], [1, 1])
}

/** Fenced code blocks as `[opening line, closing line]` indexes; an unclosed one runs to the end. */
function fencedBlocks(lines: string[]): Array<[number, number]> {
  const blocks: Array<[number, number]> = []
  let open: { index: number; fence: string } | null = null
  for (let i = 0; i < lines.length; i += 1) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i])
    if (!fence) continue
    if (open === null) {
      // After backticks, the info string cannot contain one.
      if (!(fence[1][0] === '`' && fence[2].includes('`'))) open = { index: i, fence: fence[1] }
    } else if (
      fence[1][0] === open.fence[0] &&
      fence[1].length >= open.fence.length &&
      fence[2].trim() === ''
    ) {
      blocks.push([open.index, i])
      open = null
    }
  }
  if (open !== null) blocks.push([open.index, lines.length])
  return blocks
}

function lineIndex(value: string, position: number): number {
  return value.slice(0, position).split('\n').length - 1
}

/** Whether the `count` lines from the one holding `position` are all in one fenced block. */
function insideCodeBlock(value: string, position: number, count: number): boolean {
  const first = lineIndex(value, position)
  const last = first + count - 1
  return fencedBlocks(value.split('\n')).some(([open, close]) => open <= first && last <= close)
}

function toggleCodeBlock(state: TextState): Edit | null {
  const { value, start, end } = state
  const texts = value.split('\n')
  const touched = touchedLines(value, start, end)
  const first = lineIndex(value, start)
  const last = first + touched.length - 1

  const block = fencedBlocks(texts).find(([open, close]) => open <= first && last <= close)
  if (block) {
    const [open, close] = block
    const opening = lineAt(value, offsetOfLine(texts, open))
    const changes: Change[] = [{ from: opening.start, to: Math.min(opening.end + 1, value.length), insert: '' }]
    if (close < texts.length) {
      const closing = lineAt(value, offsetOfLine(texts, close))
      // The newline in front of the closing fence, unless the opening's
      // removal already took it.
      const from = close === open + 1 ? closing.start : closing.start - 1
      changes.push({ from, to: closing.end, insert: '' })
    }
    return commit(value, changes, [start, end], [1, -1])
  }

  const firstLine = touched[0]
  const lastLine = touched[touched.length - 1]
  const longest = Math.max(
    0,
    ...touched.map((line) => /^ {0,3}(`{3,})/.exec(line.text)?.[1].length ?? 0),
  )
  const fence = '`'.repeat(Math.max(3, longest + 1))
  const shift = fence.length + 1

  if (touched.length === 1 && isBlank(firstLine.text)) {
    const caret = firstLine.start + shift
    return { from: firstLine.start, to: firstLine.end, insert: `${fence}\n\n${fence}`, selection: [caret, caret] }
  }
  return {
    from: firstLine.start,
    to: lastLine.end,
    insert: `${fence}\n${value.slice(firstLine.start, lastLine.end)}\n${fence}`,
    selection: [Math.max(start, firstLine.start) + shift, Math.min(end, lastLine.end) + shift],
  }
}

function offsetOfLine(texts: string[], index: number): number {
  let offset = 0
  for (let i = 0; i < index; i += 1) offset += texts[i].length + 1
  return offset
}

/**
 * Indent or outdent the list items the selection touches. Only lists: an
 * indented paragraph is a code block in markdown, which is not what anyone
 * pressing Indent meant.
 *
 * Indenting lines an item up under its previous sibling's text, which is
 * where CommonMark needs it to nest -- three spaces under `1. `, two under
 * `- `. Outdenting lines it up with its parent. The lines after the first
 * move by the same amount, so whatever is nested under them comes along.
 */
function shiftList(state: TextState, direction: 1 | -1): Edit | null {
  const { value, start, end } = state
  const lines = touchedLines(value, start, end)
  const first = lines.find((line) => structure(line.text).list !== null)
  if (!first) return null

  const s = structure(first.text)
  const width = columns(s.indent)
  let delta: number
  if (direction > 0) {
    const sibling = itemAbove(value, first, s, (w) => w === width, (w) => w < width)
    delta = (sibling ? columns(sibling.indent) + sibling.marker.length : width + s.marker.length) - width
  } else {
    const parent = itemAbove(value, first, s, (w) => w < width, () => false)
    delta = width - (parent ? columns(parent.indent) : 0)
    if (delta <= 0) return null
  }

  const changes = lines
    .filter((line) => !isBlank(line.text))
    .map((line): Change => {
      const t = structure(line.text)
      const at = line.start + t.quote.length
      if (direction > 0) return { from: at, to: at, insert: ' '.repeat(delta) }
      let remove = 0
      let removed = 0
      while (remove < t.indent.length && removed < delta) {
        removed += t.indent[remove] === '\t' ? 4 : 1
        remove += 1
      }
      return { from: at, to: at + remove, insert: '' }
    })
  return commit(value, changes, [start, end], [1, 1])
}

/**
 * The nearest list item above `line` in the same list whose indent `wanted`
 * accepts, or null if `stop` rejects one first, or the list ends: a line at
 * the margin that is not an item.
 */
function itemAbove(
  value: string,
  line: Line,
  s: Structure,
  wanted: (width: number) => boolean,
  stop: (width: number) => boolean,
): Structure | null {
  let position = line.start
  while (position > 0) {
    const above = lineAt(value, position - 1)
    position = above.start
    if (isBlank(above.text)) continue
    const a = structure(above.text)
    if (quoteDepth(a.quote) !== quoteDepth(s.quote)) return null
    const width = columns(a.indent)
    if (a.list === null) {
      if (width === 0) return null
      continue
    }
    if (wanted(width)) return a
    if (stop(width)) return null
  }
  return null
}
