import { auth } from '@/i18n/en/auth'
import { board } from '@/i18n/en/board'
import { common } from '@/i18n/en/common'
import { cycles } from '@/i18n/en/cycles'
import { issues } from '@/i18n/en/issues'
import { landing } from '@/i18n/en/landing'
import { projects } from '@/i18n/en/projects'
import { reports } from '@/i18n/en/reports'
import { settings } from '@/i18n/en/settings'
import { team } from '@/i18n/en/team'
import { views } from '@/i18n/en/views'

/** Every catalog, by language and namespace. English is the only language. */
export const resources = {
  en: {
    common,
    settings,
    issues,
    board,
    auth,
    team,
    landing,
    projects,
    views,
    reports,
    cycles,
  },
} as const
