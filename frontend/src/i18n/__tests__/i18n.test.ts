import { describe, expect, it } from 'vitest'

import { i18n } from '@/i18n'
import { formatDate, formatNumber, formatRelative } from '@/i18n/format'

describe('the i18n layer (#106)', () => {
  it('is ready on import, in English, with the settings namespace', () => {
    expect(i18n.isInitialized).toBe(true)
    expect(i18n.language).toBe('en')
    expect(i18n.t('settings:statuses.intro', { team: 'Engineering' })).toBe(
      'The columns on Engineering’s board, in order.',
    )
    expect(i18n.t('common:cancel')).toBe('Cancel')
  })

  it('does not escape what React will escape anyway', () => {
    expect(i18n.t('settings:statuses.deleteDialog.title', { name: 'R&D <review>' })).toBe(
      'Delete “R&D <review>”',
    )
  })

  it('formats dates and numbers through one locale', () => {
    expect(formatDate(new Date(2026, 8, 25), 'd MMM yyyy')).toBe('25 Sep 2026')
    expect(formatNumber(12345.5)).toBe('12,345.5')
    expect(formatRelative(Date.now() - 3 * 24 * 60 * 60 * 1000)).toBe('3 days ago')
  })
})
