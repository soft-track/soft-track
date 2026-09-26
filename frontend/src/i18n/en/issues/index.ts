// Issues (#106): the issue card, the new-issue form, the issue panel and page.
import { meta } from '@/i18n/en/issues/meta'
import { history } from '@/i18n/en/issues/history'
import { card } from '@/i18n/en/issues/card'
import { newIssue } from '@/i18n/en/issues/newIssue'
import { move } from '@/i18n/en/issues/move'
import { panel } from '@/i18n/en/issues/panel'
import { page } from '@/i18n/en/issues/page'
import { properties } from '@/i18n/en/issues/properties'
import { description } from '@/i18n/en/issues/description'
import { comments } from '@/i18n/en/issues/comments'
import { links } from '@/i18n/en/issues/links'
import { subIssues } from '@/i18n/en/issues/subIssues'
import { development } from '@/i18n/en/issues/development'
import { time } from '@/i18n/en/issues/time'

export const issues = {
  meta,
  history,
  card,
  newIssue,
  move,
  panel,
  page,
  properties,
  description,
  comments,
  links,
  subIssues,
  development,
  time,
} as const
