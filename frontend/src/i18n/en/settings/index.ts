// Settings (#106): one catalog per page, keyed by the page.
import { statuses } from '@/i18n/en/settings/statuses'
import { layout } from '@/i18n/en/settings/layout'
import { profile } from '@/i18n/en/settings/profile'
import { security } from '@/i18n/en/settings/security'
import { notifications } from '@/i18n/en/settings/notifications'
import { apiTokens } from '@/i18n/en/settings/apiTokens'
import { connectedAccounts } from '@/i18n/en/settings/connectedAccounts'
import { adminUsers } from '@/i18n/en/settings/adminUsers'
import { departments } from '@/i18n/en/settings/departments'
import { requireSiteAdmin } from '@/i18n/en/settings/requireSiteAdmin'
import { roles } from '@/i18n/en/settings/roles'
import { members } from '@/i18n/en/settings/members'
import { general } from '@/i18n/en/settings/general'
import { automation } from '@/i18n/en/settings/automation'
import { integrations } from '@/i18n/en/settings/integrations'
import { webhooks } from '@/i18n/en/settings/webhooks'
import { templates } from '@/i18n/en/settings/templates'
import { fields } from '@/i18n/en/settings/fields'

export const settings = {
  statuses,
  layout,
  profile,
  security,
  notifications,
  apiTokens,
  connectedAccounts,
  adminUsers,
  departments,
  requireSiteAdmin,
  roles,
  members,
  general,
  automation,
  integrations,
  webhooks,
  templates,
  fields,
} as const
