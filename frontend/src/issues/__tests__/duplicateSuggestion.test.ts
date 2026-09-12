import { describe, expect, it } from 'vitest'
import { MIN_WORDS_TO_SUGGEST, getSearchPhrase, shouldShowSuggestions, wordCount } from '../duplicateSuggestion'

describe('wordCount', () => {
  it('counts space-delimited words', () => {
    expect(wordCount('login button broken')).toBe(3)
  })

  it('returns 0 for empty input', () => {
    expect(wordCount('   ')).toBe(0)
  })

  it('counts words in scripts with no spacing', () => {
    expect(wordCount('登录按钮在移动端无法点击')).toBeGreaterThan(1)
  })
})

describe('shouldShowSuggestions', () => {
  it('is false below the word threshold', () => {
    expect(shouldShowSuggestions('login broken', false)).toBe(false)
  })

  it('is true at the word threshold', () => {
    expect(shouldShowSuggestions('login button broken', false)).toBe(true)
  })

  it('stays false once dismissed, even above threshold', () => {
    expect(shouldShowSuggestions('login button broken', true)).toBe(false)
  })
})

describe('getSearchPhrase', () => {
  it('freezes at the given word count', () => {
    expect(getSearchPhrase('login button does not work on mobile', MIN_WORDS_TO_SUGGEST)).toBe(
      'login button does',
    )
  })

  it('does not pad short titles', () => {
    expect(getSearchPhrase('login broken', MIN_WORDS_TO_SUGGEST)).toBe('login broken')
  })
})