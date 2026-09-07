import { describe, expect, it } from 'vitest'

import { mentionQueryAt } from '../mentionQuery'

/** Caret position is marked with | in these fixtures. */
function at(withCaret: string) {
  const caret = withCaret.indexOf('|')
  return mentionQueryAt(withCaret.replace('|', ''), caret)
}

describe('mentionQueryAt', () => {
  it('opens on a bare @', () => {
    expect(at('@|')).toEqual({ query: '', start: 0 })
  })

  it('captures what has been typed so far', () => {
    expect(at('ping @ad|')).toEqual({ query: 'ad', start: 5 })
  })

  it('closes once a space is typed', () => {
    expect(at('@ada |')).toBeNull()
  })

  it('does not open inside an email address being typed', () => {
    expect(at('write to demo@|')).toBeNull()
  })

  it('does not open on an @ in a path', () => {
    expect(at('/users/@de|')).toBeNull()
  })

  it('ignores text after the caret', () => {
    expect(at('@ad| and the rest')).toEqual({ query: 'ad', start: 0 })
  })

  it('reports a start offset that points at the @', () => {
    const result = at('hello @world|')
    expect('hello @world'[result!.start]).toBe('@')
  })
})
