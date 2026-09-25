import { attachments } from '@/i18n/en/attachments'
import { auth } from '@/i18n/en/auth'
import { automations } from '@/i18n/en/automations'
import { board } from '@/i18n/en/board'
import { calendar } from '@/i18n/en/calendar'
import { common } from '@/i18n/en/common'
import { cycles } from '@/i18n/en/cycles'
import { errors } from '@/i18n/en/errors'
import { imports } from '@/i18n/en/imports'
import { issues } from '@/i18n/en/issues'
import { keyboard } from '@/i18n/en/keyboard'
import { landing } from '@/i18n/en/landing'
import { markdown } from '@/i18n/en/markdown'
import { notifications } from '@/i18n/en/notifications'
import { projects } from '@/i18n/en/projects'
import { reports } from '@/i18n/en/reports'
import { search } from '@/i18n/en/search'
import { settings } from '@/i18n/en/settings'
import { team } from '@/i18n/en/team'
import { ui } from '@/i18n/en/ui'
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
    automations,
    imports,
    search,
    keyboard,
    notifications,
    calendar,
    attachments,
    markdown,
    ui,
    errors,
  },
} as const
