import { parseISO } from 'date-fns'

import { formatDate, formatNumber } from '@/i18n/format'

/**
 * Money as every finance screen shows it (#131).
 *
 * Amounts arrive as integers in the currency's minor unit -- 645000 is
 * £6,450.00 -- with the currency's decimal places from GET /currencies, so
 * the browser never keeps its own copy of which currency has how many.
 * Nothing here converts one currency into another, anywhere.
 */

/** "£6,450.00": an amount in minor units, with its currency's own decimals. */
export function formatMoney(minor: number, currency: string, places: number): string {
  return formatNumber(minor / 10 ** places, {
    style: 'currency',
    currency,
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
}

/**
 * What somebody typed, in minor units: "8,300.00" is 830000 at two places.
 * Null when it is not an amount, or has more decimals than the currency has
 * -- a tenth of a cent is refused here rather than rounded away. Read from
 * the digits rather than through a float, so nothing is lost on the way.
 */
export function toMinorUnits(text: string, places: number): number | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text.replace(/[\s,]/g, ''))
  if (!match) return null
  const [, whole, fraction = ''] = match
  if (fraction.length > places) return null
  const minor = Number(whole) * 10 ** places + Number(fraction.padEnd(places, '0') || 0)
  return Number.isSafeInteger(minor) ? minor : null
}

/** 830000 at two places as "8300.00", for a field to start from. */
export function fromMinorUnits(minor: number, places: number): string {
  if (places === 0) return String(minor)
  const scale = 10 ** places
  return `${Math.floor(minor / scale)}.${String(minor % scale).padStart(places, '0')}`
}

/** "+4.7%": how much pay changed. */
export function formatChange(percent: number): string {
  return formatNumber(percent / 100, {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  })
}

/**
 * A day the API sent as `2026-03-01`: "1 Mar 2026". `parseISO` rather than
 * `new Date()`, which reads a bare date as midnight UTC and shows the day
 * before to anybody west of Greenwich.
 */
export function formatDay(value: string): string {
  return formatDate(parseISO(value), 'd MMM yyyy')
}

/** "$", "£", "€": what goes in front of an amount field. */
export function currencySymbol(currency: string): string {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? currency
    )
  } catch {
    return currency
  }
}
