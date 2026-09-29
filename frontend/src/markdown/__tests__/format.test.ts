import { describe, expect, it } from 'vitest'

import {
  type Command,
  type Edit,
  type TextState,
  formatsAt,
  runCommand,
  setHeading,
} from '@/markdown/format'

const PLACEHOLDERS = {
  bold: 'bold text',
  italic: 'italic text',
  strikethrough: 'struck text',
  code: 'code',
  linkText: 'link text',
  url: 'url',
}

/** `«…»` marks the selection and `|` a caret, before and after. */
function parse(marked: string): TextState {
  const caret = marked.indexOf('|')
  if (caret !== -1) return { value: marked.replace('|', ''), start: caret, end: caret }
  const start = marked.indexOf('«')
  const end = marked.indexOf('»') - 1
  return { value: marked.replace('«', '').replace('»', ''), start, end }
}

function show(state: TextState, edit: Edit | null): string {
  if (!edit) return 'no change'
  const value = state.value.slice(0, edit.from) + edit.insert + state.value.slice(edit.to)
  const [a, b] = edit.selection
  if (a === b) return `${value.slice(0, a)}|${value.slice(a)}`
  return `${value.slice(0, a)}«${value.slice(a, b)}»${value.slice(b)}`
}

const run = (command: Command, marked: string) =>
  show(parse(marked), runCommand(command, parse(marked), PLACEHOLDERS))

const heading = (level: number, marked: string) => show(parse(marked), setHeading(parse(marked), level))

const at = (marked: string) => formatsAt(parse(marked))

describe('inline formatting', () => {
  it('wraps the selection and keeps it inside the markers', () => {
    expect(run('bold', 'The ghost is off by «offset math» on Safari.')).toBe(
      'The ghost is off by **«offset math»** on Safari.',
    )
    expect(run('italic', '«quietly»')).toBe('*«quietly»*')
    expect(run('strikethrough', '«gone»')).toBe('~~«gone»~~')
    expect(run('code', 'run «npm test»')).toBe('run `«npm test»`')
  })

  it('unwraps on a second press, markers selected or not', () => {
    expect(run('bold', 'The ghost is off by **«offset math»** on Safari.')).toBe(
      'The ghost is off by «offset math» on Safari.',
    )
    expect(run('bold', 'off by «**offset math**» on')).toBe('off by «offset math» on')
    expect(run('code', 'run `«npm test»`')).toBe('run «npm test»')
  })

  it('unwraps the span around a caret', () => {
    expect(run('bold', 'a **offset| math** b')).toBe('a offset| math b')
    expect(run('strikethrough', '~~|gone~~')).toBe('|gone')
  })

  it('writes a selected placeholder when nothing is selected', () => {
    expect(run('bold', 'Remember to |')).toBe('Remember to **«bold text»**')
    expect(run('italic', '|')).toBe('*«italic text»*')
    expect(run('code', 'run |')).toBe('run `«code»`')
  })

  it('keeps whitespace outside the markers, where CommonMark needs it', () => {
    expect(run('bold', 'a« word »b')).toBe('a **«word»** b')
  })

  it('merges spans of the same kind instead of nesting them', () => {
    expect(run('bold', '«a **b** c»')).toBe('**«a b c»**')
    expect(run('bold', 'x «a **b» c** y')).toBe('x **«a b c»** y')
  })

  it('stacks italic and bold, and takes either back off', () => {
    expect(run('italic', '**«x»**')).toBe('***«x»***')
    expect(run('italic', '***«x»***')).toBe('**«x»**')
    expect(run('bold', '***«x»***')).toBe('*«x»*')
  })

  it('picks a code fence the text cannot close early', () => {
    expect(run('code', 'use «a`b» here')).toBe('use ``«a`b»`` here')
    expect(run('code', 'x «`a» y')).toBe('x `` «`a» `` y')
  })

  it('formats each line of a multi-line selection, past its list markers', () => {
    expect(run('bold', '«- one\n- two»')).toBe('«- **one**\n- **two**»')
    expect(run('bold', '«- **one**\n- **two**»')).toBe('«- one\n- two»')
  })

  it('does not bold the space between two bold spans', () => {
    expect(run('bold', '**a** «b» **c**')).toBe('**a** **«b»** **c**')
  })
})

describe('links', () => {
  it('uses the selection as the text and selects the address to type', () => {
    expect(run('link', 'see «the docs»')).toBe('see [the docs](«url»)')
  })

  it('uses a selected address as the destination', () => {
    expect(run('link', 'see «https://x.dev»')).toBe('see [«link text»](https://x.dev)')
  })

  it('writes a placeholder link when nothing is selected', () => {
    expect(run('link', 'see |')).toBe('see [«link text»](url)')
  })

  it('unlinks when the caret is anywhere in a link', () => {
    expect(run('link', 'see [the| docs](https://x.dev)')).toBe('see the| docs')
    expect(run('link', 'see [the docs](https://x.|dev)')).toBe('see the docs|')
  })
})

describe('headings', () => {
  it('sets, changes and clears the level of the caret line', () => {
    expect(heading(3, 'Rep|ro')).toBe('### Rep|ro')
    expect(heading(1, '### Rep|ro')).toBe('# Rep|ro')
    expect(heading(0, '# Rep|ro')).toBe('Rep|ro')
    expect(heading(2, '## Rep|ro')).toBe('no change')
  })

  it('leaves the caret after the new marker, where typing continues', () => {
    expect(heading(2, '|Repro')).toBe('## |Repro')
  })

  it('toggles a level-3 heading from the compact menu', () => {
    expect(run('heading', 'Rep|ro')).toBe('### Rep|ro')
    expect(run('heading', '# Rep|ro')).toBe('Rep|ro')
  })

  it('keeps a quote marker in front', () => {
    expect(heading(2, '> Rep|ro')).toBe('> ## Rep|ro')
  })
})

describe('lists', () => {
  it('turns every touched line into a list item, and back', () => {
    expect(run('bulletList', '«one\ntwo»')).toBe('- «one\n- two»')
    expect(run('bulletList', '- «one\n- two»')).toBe('«one\ntwo»')
  })

  it('numbers lines in order, carrying on from a numbered item above', () => {
    expect(run('numberedList', '«a\nb\nc»')).toBe('1. «a\n2. b\n3. c»')
    expect(run('numberedList', '1. a\n2. b\n|c')).toBe('1. a\n2. b\n3. |c')
  })

  it('switches between kinds, keeping the author’s bullet', () => {
    expect(run('checklist', '- «task»')).toBe('- [ ] «task»')
    expect(run('checklist', '* «task»')).toBe('* [ ] «task»')
    expect(run('bulletList', '- [ ] «task»')).toBe('- «task»')
    expect(run('numberedList', '- «a»')).toBe('1. «a»')
  })

  it('skips blank lines inside the selection', () => {
    expect(run('bulletList', '«a\n\nb»')).toBe('- «a\n\n- b»')
  })

  it('starts a list on an empty line with the caret after the marker', () => {
    expect(run('checklist', 'x\n|')).toBe('x\n- [ ] |')
  })

  it('ignores a line the selection only reaches the start of', () => {
    expect(run('bulletList', '«a\n»b')).toBe('- «a\n»b')
  })
})

describe('quotes', () => {
  it('quotes the touched lines, joining paragraphs with a bare >', () => {
    expect(run('quote', '«a\n\nb»')).toBe('> «a\n>\n> b»')
    expect(run('quote', '> «a\n>\n> b»')).toBe('«a\n\nb»')
  })
})

describe('code blocks', () => {
  it('fences the touched lines, and unfences them', () => {
    expect(run('codeBlock', '«one\ntwo»')).toBe('```\n«one\ntwo»\n```')
    expect(run('codeBlock', '```\non|e\n```')).toBe('on|e')
    expect(run('codeBlock', 'a\n```\n|\n```\nb')).toBe('a\n|\nb')
  })

  it('opens an empty block on an empty line, caret inside', () => {
    expect(run('codeBlock', '|')).toBe('```\n|\n```')
  })

  it('uses a longer fence around a fence', () => {
    expect(run('codeBlock', '«a\n```»')).toBe('````\n«a\n```»\n````')
  })
})

describe('indent and outdent', () => {
  it('nests an item under its previous sibling’s text', () => {
    expect(run('indent', '1. a\n2. |b')).toBe('1. a\n   2. |b')
    expect(run('indent', '- a\n- |b')).toBe('- a\n  - |b')
  })

  it('brings nested items along', () => {
    expect(run('indent', '- a\n- «b\n  - c»')).toBe('- a\n  - «b\n    - c»')
  })

  it('outdents to the parent, and stops at the margin', () => {
    expect(run('outdent', '- a\n  - |b')).toBe('- a\n- |b')
    expect(run('outdent', '- |a')).toBe('no change')
  })

  it('does nothing outside a list', () => {
    expect(run('indent', 'plain |text')).toBe('no change')
    expect(run('outdent', 'plain |text')).toBe('no change')
  })
})

describe('clear formatting', () => {
  it('strips the markers of everything the selection touches', () => {
    expect(run('clear', '«**a** and [b](u) and `c`»')).toBe('«a and b and c»')
  })

  it('strips what is around a caret', () => {
    expect(run('clear', '**bo|ld**')).toBe('bo|ld')
    expect(run('clear', 'plain |text')).toBe('no change')
  })

  it('keeps images', () => {
    expect(run('clear', '«![alt](i.png)»')).toBe('no change')
  })
})

describe('formatsAt', () => {
  it('knows the selection is bold, and that the gap between two bold spans is not', () => {
    expect(at('**bo|ld**').bold).toBe(true)
    expect(at('The ghost is off by **«offset math»** on Safari.').bold).toBe(true)
    expect(at('**a** |b **c**').bold).toBe(false)
    expect(at('**a** «b» **c**').bold).toBe(false)
  })

  it('reads the caret line’s heading and list', () => {
    expect(at('## Rep|ro').heading).toBe(2)
    expect(at('- [ ] ta|sk')).toMatchObject({ checklist: true, bulletList: false, list: true })
    expect(at('1. o|ne')).toMatchObject({ numberedList: true, list: true })
    expect(at('> quo|te').quote).toBe(true)
    expect(at('[li|nk](u)').link).toBe(true)
    expect(at('pla|in').list).toBe(false)
  })

  it('reports nothing inline inside a fenced block', () => {
    expect(at('```\n**no|t bold**\n```')).toMatchObject({ codeBlock: true, bold: false })
  })
})
