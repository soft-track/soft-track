import type { TeamRole } from '@/api/generated/models'
import { i18n } from '@/i18n'

// Read from the catalog once, at load: English is the only language (#106).
export const ROLE_LABELS: Record<TeamRole, string> = {
  admin: i18n.t('settings:roles.labels.admin'),
  member: i18n.t('settings:roles.labels.member'),
  guest: i18n.t('settings:roles.labels.guest'),
}

/** What each role may do, for the places a role is being chosen. */
export const ROLE_HINTS: Record<TeamRole, string> = {
  admin: i18n.t('settings:roles.hints.admin'),
  member: i18n.t('settings:roles.hints.member'),
  guest: i18n.t('settings:roles.hints.guest'),
}
