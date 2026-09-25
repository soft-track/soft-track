import { common } from '@/i18n/en/common'
import { settings } from '@/i18n/en/settings'

/** Every catalog, by language and namespace. English is the only language. */
export const resources = {
  en: { common, settings },
} as const
