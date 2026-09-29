import { useListCustomFieldsTeamsTeamIdCustomFieldsGet } from '@/api/generated/endpoints/custom-fields/custom-fields'
import type {
  CustomFieldKind,
  CustomFieldRead,
  TicketReadCustomFields,
  TicketType,
  UserPublic,
} from '@/api/generated/models'
import { i18n } from '@/i18n'
import { formatList, formatNumber } from '@/i18n/format'
import { shortDue } from '@/tickets/dueDate'
import type { IconName } from '@/ui/Icon'

/** A value as the ticket reads it: a person is the whole user. */
export type FieldValue = TicketReadCustomFields[string]

/** A value as the API takes it: a person is their id, null clears it. */
export type FieldInput = boolean | number | string | string[] | null

/**
 * A team's own fields (#117), in the order its admins set. Archived ones
 * are included: their values still show on the tickets that have them.
 *
 * Read where they are used rather than carried in TeamContext -- the query
 * is cached by key, so the panel, the form and the settings page share one.
 */
export function useCustomFields(teamId: number): CustomFieldRead[] {
  return (
    useListCustomFieldsTeamsTeamIdCustomFieldsGet(teamId, {
      query: { enabled: teamId > 0 },
    }).data ?? []
  )
}

/** The eight kinds, in the order "Add a field" offers them. */
export const KIND_ORDER: CustomFieldKind[] = [
  'text',
  'number',
  'select',
  'multi_select',
  'user',
  'date',
  'checkbox',
  'url',
]

/** Each kind's icon and name. The checkbox is the task's box with a tick. */
export const KIND_META: Record<CustomFieldKind, { icon: IconName; readonly label: string }> = {
  text: kind('text', 'type'),
  number: kind('number', 'hash'),
  select: kind('select', 'select-box'),
  multi_select: kind('multi_select', 'list-check'),
  user: kind('user', 'user'),
  date: kind('date', 'calendar'),
  checkbox: kind('checkbox', 'task'),
  url: kind('url', 'globe'),
}

function kind(key: CustomFieldKind, icon: IconName) {
  return {
    icon,
    get label() {
      return i18n.t(`tickets:customFields.kinds.${key}`)
    },
  }
}

/** Whether a ticket of this type has the field. No types listed is all of them. */
export function appliesTo(field: CustomFieldRead, type: TicketType): boolean {
  return field.applies_to.length === 0 || field.applies_to.includes(type)
}

/** The fields a form offers for a ticket of this type: not archived, and its. */
export function editableFields(fields: CustomFieldRead[], type: TicketType): CustomFieldRead[] {
  return fields.filter((field) => !field.archived_at && appliesTo(field, type))
}

export function isPerson(value: FieldValue | FieldInput | undefined): value is UserPublic {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a value says anything. An unticked box and an empty list do not. */
export function isFilled(value: FieldValue | FieldInput | undefined): boolean {
  if (value === null || value === undefined || value === false || value === '') return false
  return !Array.isArray(value) || value.length > 0
}

/** A value read from a ticket, as the API would take it back. */
export function toInput(value: FieldValue | undefined): FieldInput {
  if (value === undefined) return null
  return isPerson(value) ? value.id : value
}

/**
 * The required fields a new ticket of this type has left empty, in order --
 * the same check the API makes, so the form can say so before it is sent.
 */
export function missingRequired(
  fields: CustomFieldRead[],
  type: TicketType,
  values: Record<string, FieldInput>,
): CustomFieldRead[] {
  return editableFields(fields, type).filter(
    (field) => field.required && !isFilled(values[field.key]),
  )
}

/** The names of the options a select value holds; a removed one is skipped. */
export function optionNames(field: CustomFieldRead, value: FieldValue | string | null): string[] {
  const ids = Array.isArray(value) ? value : [value]
  return ids.flatMap((id) => field.options.filter((option) => option.id === id).map((o) => o.name))
}

/** A value as one line of text, for a field that is shown and not edited. */
export function displayValue(field: CustomFieldRead, value: FieldValue): string {
  if (isPerson(value)) return value.full_name
  switch (field.kind) {
    case 'select':
    case 'multi_select':
      return formatList(optionNames(field, value))
    case 'checkbox':
      return i18n.t('tickets:customFields.yes')
    case 'date':
      return shortDue(String(value))
    case 'number':
      return formatNumber(Number(value))
    default:
      return String(value)
  }
}

/**
 * A link short enough for a property row: the host, and the last part of
 * the path -- `sentry.io/…/48213`. The whole address is the link's title.
 */
export function shortUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter(Boolean)
    const host = parsed.host.replace(/^www\./, '')
    if (parts.length === 0) return host
    if (parts.length === 1) return `${host}/${parts[0]}`
    return `${host}/…/${parts[parts.length - 1]}`
  } catch {
    return url
  }
}

/**
 * A key made from a name, the way the API makes one when it is left out:
 * "QA assignee" is `qa_assignee`. Shown in the form so an admin sees -- and
 * can change -- what scripts will call the field before it is fixed.
 */
export function keyFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '')
  if (!slug || !/^[a-z]/.test(slug)) return `field_${slug}`.replace(/_+$/, '').slice(0, 40)
  return slug
}

/** What the API accepts as a key: lowercase, digits and underscores, from a letter. */
export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/
