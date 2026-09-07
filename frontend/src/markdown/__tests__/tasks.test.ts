import { describe, expect, it } from 'vitest'

import { hasTaskList, taskProgress, toggleTaskAtOffset } from '../tasks'

const DOC = `# Release checklist

Some prose that mentions [x] in passing.

- [ ] Write the migration
- [x] Update the changelog
- [ ] Tag the release

1. [ ] An ordered task
`

/** The offset of the list item that starts with `text`, as hast reports it. */
function offsetOfItem(source: string, text: string): number {
  const line = source.split('\n').find((l) => l.includes(text))
  if (!line) throw new Error(`no line containing ${text}`)
  return source.indexOf(line)
}

describe('toggleTaskAtOffset', () => {
  it('checks an unchecked box', () => {
    const next = toggleTaskAtOffset(DOC, offsetOfItem(DOC, 'Write the migration'))
    expect(next).toContain('- [x] Write the migration')
  })

  it('unchecks a checked box', () => {
    const next = toggleTaskAtOffset(DOC, offsetOfItem(DOC, 'Update the changelog'))
    expect(next).toContain('- [ ] Update the changelog')
  })

  it('changes exactly one character', () => {
    const next = toggleTaskAtOffset(DOC, offsetOfItem(DOC, 'Tag the release'))!
    expect(next).toHaveLength(DOC.length)

    const differing = [...next].filter((char, i) => char !== DOC[i])
    expect(differing).toEqual(['x'])
  })

  it('leaves every other line untouched', () => {
    const next = toggleTaskAtOffset(DOC, offsetOfItem(DOC, 'Write the migration'))!
    const before = DOC.split('\n')
    const after = next.split('\n')

    for (let i = 0; i < before.length; i++) {
      if (before[i].includes('Write the migration')) continue
      expect(after[i]).toBe(before[i])
    }
  })

  it('handles ordered task lists', () => {
    const next = toggleTaskAtOffset(DOC, offsetOfItem(DOC, 'An ordered task'))
    expect(next).toContain('1. [x] An ordered task')
  })

  it('accepts an uppercase [X] as checked', () => {
    const source = '- [X] Already done'
    expect(toggleTaskAtOffset(source, 0)).toBe('- [ ] Already done')
  })

  it('refuses an offset with no checkbox rather than guessing', () => {
    // Pointing at the prose line that happens to contain "[x]".
    expect(toggleTaskAtOffset(DOC, offsetOfItem(DOC, 'in passing'))).toBeNull()
    expect(toggleTaskAtOffset(DOC, -1)).toBeNull()
    expect(toggleTaskAtOffset(DOC, DOC.length + 10)).toBeNull()
  })

  it('does not treat a bracketed word in a list as a task', () => {
    const source = '- [see the docs](https://example.com)'
    expect(toggleTaskAtOffset(source, 0)).toBeNull()
  })
})

describe('taskProgress', () => {
  it('counts done and total', () => {
    expect(taskProgress(DOC)).toEqual({ done: 1, total: 4 })
  })

  it('reports zero total for a document with no tasks', () => {
    expect(taskProgress('Just some prose.')).toEqual({ done: 0, total: 0 })
    expect(hasTaskList('Just some prose.')).toBe(false)
  })

  it('does not count the prose mention of [x]', () => {
    expect(taskProgress('Some prose that mentions [x] in passing.')).toEqual({
      done: 0,
      total: 0,
    })
  })
})
