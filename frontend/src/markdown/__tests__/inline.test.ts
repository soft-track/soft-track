import { describe, expect, it } from 'vitest'

import { type SpanKind, inlineSpans } from '@/markdown/inline'

/** Each span as `kind:content`, which reads better in a failure than offsets. */
const spans = (line: string) =>
  inlineSpans(line).map((span) => `${span.kind}:${line.slice(span.contentStart, span.contentEnd)}`)

const kinds = (line: string): SpanKind[] => inlineSpans(line).map((span) => span.kind)

describe('inlineSpans', () => {
  it('finds strong, emphasis and strikethrough with their markers', () => {
    expect(inlineSpans('a **b** c')).toEqual([
      { kind: 'strong', start: 2, end: 7, contentStart: 4, contentEnd: 5 },
    ])
    expect(spans('*it* and _it_')).toEqual(['emphasis:it', 'emphasis:it'])
    expect(spans('__strong__')).toEqual(['strong:strong'])
    expect(spans('~~gone~~ and ~one~')).toEqual(['strike:gone', 'strike:one'])
  })

  it('does not pair the closing markers of one span with the opening of the next', () => {
    // `b` has `**` on both sides and is not bold.
    expect(spans('**a** b **c**')).toEqual(['strong:a', 'strong:c'])
  })

  it('reads *** as emphasis around strong, and nests the other way round too', () => {
    expect(spans('***both***')).toEqual(['emphasis:**both**', 'strong:both'])
    expect(spans('*a **b** c*')).toEqual(['emphasis:a **b** c', 'strong:b'])
    expect(spans('**a *b* c**')).toEqual(['strong:a *b* c', 'emphasis:b'])
  })

  it('leaves text that only looks like markers alone', () => {
    expect(kinds('snake_case_name')).toEqual([])
    expect(kinds('2 * 3 * 4')).toEqual([])
    expect(kinds('**unclosed')).toEqual([])
    expect(kinds('\\*escaped\\*')).toEqual([])
    expect(kinds('~~~fence~~~')).toEqual([])
    expect(kinds('~~a~')).toEqual([])
  })

  it('treats code spans as literal, fence length and padding included', () => {
    expect(spans('`a*b*c`')).toEqual(['code:a*b*c'])
    expect(spans('`` a`b ``')).toEqual(['code:a`b'])
    expect(kinds('`unclosed *em*')).toEqual(['emphasis'])
    // An escaped backtick cannot open one.
    expect(kinds('\\`not code`')).toEqual([])
  })

  it('finds links and images, and never reads their addresses as emphasis', () => {
    expect(spans('see [the **docs**](https://x.dev/a_b_c) now')).toEqual([
      'link:the **docs**',
      'strong:docs',
    ])
    expect(spans('![alt](i.png)')).toEqual(['image:alt'])
    expect(spans('[a [b] c](u(1))')).toEqual(['link:a [b] c'])
    expect(kinds('[no destination]')).toEqual([])
  })

  it('does not pair emphasis across the edge of a link', () => {
    expect(kinds('*a [b* c](u)')).toEqual(['link'])
  })
})
