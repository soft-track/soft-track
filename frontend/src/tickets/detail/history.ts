import { parseServerDate } from '@/api/dates'
import type {
  CommentRead,
  CustomFieldRef,
  TicketEventRead,
  TicketPriority,
  StatusCategory,
} from '@/api/generated/models'
import { i18n } from '@/i18n'
import { formatNumber } from '@/i18n/format'
import { shortDue } from '@/tickets/dueDate'
import { CATEGORY_META, PRIORITY_META } from '@/tickets/ticketMeta'

/** A history sentence: its catalog key and what fills it, bar the actor. */
export interface EventSentence {
  key: HistoryKey
  values: Record<string, string>
}

type HistoryKey =
  | 'status'
  | `priority.${'set' | 'changed' | 'removed'}`
  | `estimate.${'set' | 'changed' | 'cleared'}`
  | `assignee.${'assigned' | 'reassigned' | 'unassigned'}`
  | `sprint.${'added' | 'moved' | 'removed'}`
  | `due.${'set' | 'moved' | 'removed'}`
  | `project.${'added' | 'moved' | 'removed'}`
  | 'team'
  | `field.${'set' | 'changed' | 'cleared' | 'ticked' | 'unticked'}`
  | `trash.${'deleted' | 'restored'}`
  | 'other'

/**
 * What an event did, as a whole sentence whose subject is who did it:
 * "Maya moved this from Started to Done" (#81). A whole sentence rather
 * than a predicate glued to a name (#106): where the name goes is the
 * language's business.
 *
 * Statuses read as their *category*, because that is what the history keeps
 * -- see `_status_category` in backend/lib_softtrack/history.py. It is also
 * why a move between two columns of the same category never appears here: no
 * row was written for it.
 *
 * A name that has gone -- a deleted sprint or project, say -- reads as "a
 * deleted sprint" rather than as an id nobody can place.
 */
export function describeEvent(event: TicketEventRead): EventSentence {
  const { old_value: from, new_value: to } = event
  const say = (key: HistoryKey, values: Record<string, string> = {}): EventSentence => ({
    key,
    values,
  })

  switch (event.field) {
    case 'status':
      return say('status', { from: category(from), to: category(to) })

    case 'priority':
      if (!to || to === 'no_priority') return say('priority.removed', { from: priority(from) })
      if (!from || from === 'no_priority') return say('priority.set', { to: priority(to) })
      return say('priority.changed', { from: priority(from), to: priority(to) })

    case 'estimate':
      if (!to) return say('estimate.cleared', { from: points(from) })
      if (!from) return say('estimate.set', { to: points(to) })
      return say('estimate.changed', { from: points(from), to: points(to) })

    case 'assignee': {
      const before = named(event.old_label, 'formerMember')
      const after = named(event.new_label, 'formerMember')
      if (!to) return say('assignee.unassigned', { from: before })
      if (!from) return say('assignee.assigned', { to: after })
      return say('assignee.reassigned', { from: before, to: after })
    }

    case 'sprint': {
      const before = named(event.old_label, 'deletedSprint')
      const after = named(event.new_label, 'deletedSprint')
      if (!to) return say('sprint.removed', { from: before })
      if (!from) return say('sprint.added', { to: after })
      return say('sprint.moved', { from: before, to: after })
    }

    case 'due_date':
      if (!to) return say('due.removed', { from: shortDue(from ?? '') })
      if (!from) return say('due.set', { to: shortDue(to) })
      return say('due.moved', { from: shortDue(from), to: shortDue(to) })

    case 'project': {
      const before = named(event.old_label, 'deletedProject')
      const after = named(event.new_label, 'deletedProject')
      if (!to) return say('project.removed', { from: before })
      if (!from) return say('project.added', { to: after })
      return say('project.moved', { from: before, to: after })
    }

    case 'team': {
      // Keys, not team names: ENG-42 becoming OPS-17 is the fact anybody
      // holding the old link needs (#98).
      const elsewhere = i18n.t('tickets:history.anotherTeam')
      return say('team', { from: from ?? elsewhere, to: to ?? elsewhere })
    }

    case 'custom_field': {
      // One of the team's own fields (#117), named as it is now. Deleting a
      // field takes its history with it, so the field is always here.
      const field = event.custom_field
      if (!field) return say('other')
      const values = { field: field.name }
      if (field.kind === 'checkbox') return say(to ? 'field.ticked' : 'field.unticked', values)
      const before = fieldValue(field, from, event.old_label)
      const after = fieldValue(field, to, event.new_label)
      if (!to) return say('field.cleared', { ...values, from: before })
      if (!from) return say('field.set', { ...values, to: after })
      return say('field.changed', { ...values, from: before, to: after })
    }

    case 'trash':
      // Into the trash and back out of it (#323). Only a ticket that came
      // back has an Activity feed to show either in.
      return say(to ? 'trash.deleted' : 'trash.restored')

    default:
      return say('other')
  }
}

/** Who did it: a person, or -- for a rule -- "Automation". */
export function actorName(event: TicketEventRead): string {
  return event.actor?.full_name ?? i18n.t('tickets:history.automation')
}

/** The sentence as plain text, for a title or a test: "Maya moved this from …". */
export function eventText(event: TicketEventRead): string {
  const { key, values } = describeEvent(event)
  // The key is typed by HistoryKey; i18next's per-key check of the values
  // cannot follow a key chosen at runtime, so it is shown one key's shape.
  const sentence = `tickets:history.${key}` as 'tickets:history.other'
  return i18n.t(sentence, { ...values, actor: actorName(event) }).replace(/<\/?actor>/g, '')
}

function category(value: string | null | undefined): string {
  return (
    CATEGORY_META[value as StatusCategory]?.label ?? i18n.t('tickets:history.unknownStatus')
  )
}

function priority(value: string | null | undefined): string {
  return PRIORITY_META[value as TicketPriority]?.label ?? i18n.t('tickets:history.noPriority')
}

function points(value: string | null | undefined): string {
  return i18n.t('tickets:history.points', { count: Number(value) })
}

/**
 * One side of a field's change. A person or an option reads as its name now
 * -- the label -- and one that has gone reads as such rather than as an id.
 */
function fieldValue(
  field: CustomFieldRef,
  value: string | null | undefined,
  label: string | null | undefined,
): string {
  // The side that had no value: the sentence chosen does not show it.
  if (value === null || value === undefined) return ''
  switch (field.kind) {
    case 'user':
      return named(label, 'formerMember')
    case 'select':
    case 'multi_select':
      return label ?? i18n.t('tickets:history.removedOption')
    case 'date':
      return shortDue(value)
    case 'number':
      return formatNumber(Number(value))
    default:
      return value
  }
}

function named(
  label: string | null | undefined,
  gone: 'formerMember' | 'deletedSprint' | 'deletedProject',
): string {
  return label ?? i18n.t(`tickets:history.${gone}`)
}

/** One row of the Activity feed: a comment or a change. */
export type ActivityItem =
  | { kind: 'comment'; at: string; comment: CommentRead }
  | { kind: 'event'; at: string; event: TicketEventRead }

/**
 * Comments and changes in one stream, oldest first -- the order the thread
 * already reads in. On a tie the change comes first: a comment is usually
 * about the change made just before it.
 */
export function interleave(comments: CommentRead[], events: TicketEventRead[]): ActivityItem[] {
  const items: ActivityItem[] = [
    ...events.map((event) => ({ kind: 'event' as const, at: event.created_at, event })),
    ...comments.map((comment) => ({ kind: 'comment' as const, at: comment.created_at, comment })),
  ]
  const time = (item: ActivityItem) => parseServerDate(item.at).getTime()
  // A stable sort, so equal timestamps keep events ahead of comments.
  return items.sort((a, b) => time(a) - time(b))
}
