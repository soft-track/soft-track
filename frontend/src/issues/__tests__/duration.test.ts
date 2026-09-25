import { describe, expect, it } from 'vitest'

import { formatDuration, parseDuration } from '@/issues/duration'

describe('parseDuration (#102)', () => {
  it.each([
    ['2h', 120],
    ['45m', 45],
    ['2h 30m', 150],
    ['1h15m', 75],
    ['1.5h', 90],
    ['2 hours 5 min', 125],
    ['2hrs', 120],
    ['2:30', 150],
    ['0:45', 45],
    ['90', 90],
    ['  3H ', 180],
  ])('reads %j as %i minutes', (input, minutes) => {
    expect(parseDuration(input)).toBe(minutes)
  })

  it.each(['', 'soon', '0', '0h', '2x', 'h', '1:75', '-5m', '2h 30'])(
    'refuses %j',
    (input) => {
      expect(parseDuration(input)).toBeNull()
    },
  )
})

describe('formatDuration', () => {
  it.each([
    [45, '45m'],
    [60, '1h'],
    [150, '2h 30m'],
    [1440, '24h'],
  ])('writes %i minutes as %j', (minutes, text) => {
    expect(formatDuration(minutes)).toBe(text)
  })
})
