// Tickets (#106): the ticket card, the new-ticket form, the ticket panel and page, and
// the linked-ticket modal (#114).
import { meta } from '@/i18n/en/tickets/meta'
import { history } from '@/i18n/en/tickets/history'
import { card } from '@/i18n/en/tickets/card'
import { newTicket } from '@/i18n/en/tickets/newTicket'
import { move } from '@/i18n/en/tickets/move'
import { panel } from '@/i18n/en/tickets/panel'
import { page } from '@/i18n/en/tickets/page'
import { modal } from '@/i18n/en/tickets/modal'
import { properties } from '@/i18n/en/tickets/properties'
import { description } from '@/i18n/en/tickets/description'
import { comments } from '@/i18n/en/tickets/comments'
import { links } from '@/i18n/en/tickets/links'
import { subTickets } from '@/i18n/en/tickets/subTickets'
import { development } from '@/i18n/en/tickets/development'
import { time } from '@/i18n/en/tickets/time'
import { customFields } from '@/i18n/en/tickets/customFields'

export const tickets = {
  meta,
  history,
  card,
  newTicket,
  move,
  panel,
  page,
  modal,
  properties,
  description,
  comments,
  links,
  subTickets,
  development,
  time,
  customFields,
} as const
