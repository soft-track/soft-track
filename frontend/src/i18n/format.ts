import { format, formatDistanceToNow, type Locale } from 'date-fns'
import { enUS } from 'date-fns/locale'

import { i18n } from '@/i18n'

/**
 * Dates and numbers for the current language (#106): the one place a locale
 * is chosen, so adding a language changes this file and not every call site.
 *
 * Converted areas format through here rather than calling date-fns or
 * toLocaleString directly.
 */
const DATE_LOCALES: Record<string, Locale> = { en: enUS }

function dateLocale(): Locale {
  return DATE_LOCALES[currentLanguage()] ?? enUS
}

function currentLanguage(): string {
  return i18n.language || 'en'
}

/** A date-fns pattern, in the current language: `formatDate(d, 'd MMM yyyy')`. */
export function formatDate(date: Date | number, pattern: string): string {
  return format(date, pattern, { locale: dateLocale() })
}

/** "3 days ago", "in 2 hours". */
export function formatRelative(date: Date | number): string {
  return formatDistanceToNow(date, { addSuffix: true, locale: dateLocale() })
}

/** A number with the current language's grouping: 12,345. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(currentLanguage(), options).format(value)
}
