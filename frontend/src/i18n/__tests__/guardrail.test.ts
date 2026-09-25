import { describe, expect, it } from 'vitest'

import { findLiterals } from '../../../scripts/i18n-literals.mjs'

const texts = (source: string) => findLiterals(source).map((found) => found.text)

describe('the i18n guardrail (#106)', () => {
  it('flags words written straight into JSX', () => {
    expect(texts('const a = <p>Save the view</p>')).toEqual(['Save the view'])
  })

  it('flags readable attributes, however they are quoted', () => {
    expect(
      texts(
        `const a = <>
          <input placeholder="Search issues" />
          <button aria-label={'Close panel'} title={\`Delete it\`} />
          <img alt="Avatar" />
        </>`,
      ),
    ).toEqual(['Search issues', 'Close panel', 'Delete it', 'Avatar'])
  })

  it('flags a string written as a JSX child', () => {
    expect(texts("const a = <span>{'Loading'}</span>")).toEqual(['Loading'])
  })

  it('leaves alone what is not copy', () => {
    expect(
      texts(`const a = (
        <div className="flex gap-2" data-testid="board" aria-hidden="true">
          {t('board.title')} · {count} — 42 / {'…'}
          <kbd>⌘</kbd>
        </div>
      )`),
    ).toEqual([])
  })

  it('honours an i18n-ignore on the line before', () => {
    expect(
      texts(`const a = (
        <p>
          {/* i18n-ignore: a product name */}
          GitHub
        </p>
      )`),
    ).toEqual([])
  })

  it('says where it found each one', () => {
    const [found] = findLiterals('const a = (\n  <p>\n    Hello there\n  </p>\n)')
    expect(found).toMatchObject({ line: 3, column: 5, text: 'Hello there' })
  })

  it('insists that a Trans given values escapes them', () => {
    expect(
      texts(`const a = <>
        <Trans t={t} i18nKey="x" values={{ name }} />
        <Trans t={t} i18nKey="x" values={{ name }} {...userText} />
        <Trans t={t} i18nKey="y" components={{ strong: <strong /> }} />
      </>`),
    ).toEqual(['<Trans values> without {...userText}'])
  })
})
