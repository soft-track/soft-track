/** Money in minor units, and back (#131). */
import { describe, expect, it } from 'vitest'

import { formatChange, formatDay, formatMoney, fromMinorUnits, toMinorUnits } from '@/finance/money'

describe('toMinorUnits', () => {
  it('reads what people type, grouping and all', () => {
    expect(toMinorUnits('8,300.00', 2)).toBe(830000)
    expect(toMinorUnits('8300', 2)).toBe(830000)
    expect(toMinorUnits(' 8 300.5 ', 2)).toBe(830050)
    expect(toMinorUnits('0.07', 2)).toBe(7)
    expect(toMinorUnits('1000', 0)).toBe(1000)
    expect(toMinorUnits('1.234', 3)).toBe(1234)
  })

  it('refuses a fraction the currency does not have, rather than rounding it', () => {
    expect(toMinorUnits('8300.505', 2)).toBeNull()
    expect(toMinorUnits('1000.5', 0)).toBeNull()
  })

  it('refuses what is not an amount', () => {
    for (const text of ['', 'abc', '-5', '1.2.3', '$5', '1e5']) {
      expect(toMinorUnits(text, 2)).toBeNull()
    }
  })

  it('does not go through a float', () => {
    // 0.29 * 100 is 28.999999999999996 in floating point.
    expect(toMinorUnits('0.29', 2)).toBe(29)
    expect(toMinorUnits('1234567.89', 2)).toBe(123456789)
  })
})

describe('fromMinorUnits', () => {
  it('writes an amount back for a field to start from', () => {
    expect(fromMinorUnits(830000, 2)).toBe('8300.00')
    expect(fromMinorUnits(7, 2)).toBe('0.07')
    expect(fromMinorUnits(1000, 0)).toBe('1000')
    expect(fromMinorUnits(1234, 3)).toBe('1.234')
  })
})

describe('formatting', () => {
  it('shows each currency with its own decimal places', () => {
    expect(formatMoney(645000, 'GBP', 2)).toBe('£6,450.00')
    expect(formatMoney(795000, 'USD', 2)).toBe('$7,950.00')
    expect(formatMoney(150000, 'JPY', 0)).toBe('¥150,000')
    // A code rather than a symbol, and a no-break space after it.
    expect(formatMoney(1234, 'KWD', 3)).toBe('KWD\u00a01.234')
  })

  it('shows a change with its sign', () => {
    expect(formatChange(4.7)).toBe('+4.7%')
    expect(formatChange(-2)).toBe('-2%')
    expect(formatChange(0)).toBe('0%')
  })

  it('shows a bare date as the day it is', () => {
    expect(formatDay('2026-03-01')).toBe('1 Mar 2026')
  })
})
