// Reports (#106): the reports page and every chart on it, and the project burnup.
import { view } from '@/i18n/en/reports/view'
import { burndown } from '@/i18n/en/reports/burndown'
import { velocity } from '@/i18n/en/reports/velocity'
import { flow } from '@/i18n/en/reports/flow'
import { createdResolved } from '@/i18n/en/reports/createdResolved'
import { burnup } from '@/i18n/en/reports/burnup'
import { timeSpent } from '@/i18n/en/reports/timeSpent'

export const reports = {
  view,
  burndown,
  velocity,
  flow,
  createdResolved,
  burnup,
  timeSpent,
} as const
