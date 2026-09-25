import { board } from '@/i18n/en/board'
import { common } from '@/i18n/en/common'
import { issues } from '@/i18n/en/issues'
import { settings } from '@/i18n/en/settings'

/** Every catalog, by language and namespace. English is the only language. */
export const resources = {
  en: { common, settings, issues, board },
} as const
