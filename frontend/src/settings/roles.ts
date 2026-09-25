import type { TeamRole } from '@/api/generated/models'
import { i18n } from '@/i18n'

// Getters over the catalog (#106), like the issue meta: callers keep reading
// `ROLE_LABELS[role]` and get the current language's word.
export const ROLE_LABELS: Record<TeamRole, string> = {
  get admin() {
    return i18n.t('settings:roles.labels.admin')
  },
  get member() {
    return i18n.t('settings:roles.labels.member')
  },
  get guest() {
    return i18n.t('settings:roles.labels.guest')
  },
}

/** What each role may do, for the places a role is being chosen. */
export const ROLE_HINTS: Record<TeamRole, string> = {
  get admin() {
    return i18n.t('settings:roles.hints.admin')
  },
  get member() {
    return i18n.t('settings:roles.hints.member')
  },
  get guest() {
    return i18n.t('settings:roles.hints.guest')
  },
}
