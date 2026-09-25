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

/**
 * "Bug, Task and Story": a list joined the current language's way.
 *
 * English is joined without a comma before "and" -- the style the interface
 * was written in -- so `en` is formatted as `en-GB`, which is the same words
 * without it. Any other language uses its own rules.
 */
export function formatList(items: string[]): string {
  const language = currentLanguage()
  return new Intl.ListFormat(language === 'en' ? 'en-GB' : language, {
    style: 'long',
    type: 'conjunction',
  }).format(items)
}

/** A number with the current language's grouping: 12,345. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(currentLanguage(), options).format(value)
}
