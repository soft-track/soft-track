import { parseServerDate } from '@/api/dates'
import type {
  CommentRead,
  IssueEventRead,
  IssuePriority,
  StatusCategory,
} from '@/api/generated/models'
import { i18n } from '@/i18n'
import { shortDue } from '@/issues/dueDate'
import { CATEGORY_META, PRIORITY_META } from '@/issues/issueMeta'

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
  | `cycle.${'added' | 'moved' | 'removed'}`
  | `due.${'set' | 'moved' | 'removed'}`
  | `project.${'added' | 'moved' | 'removed'}`
  | 'team'
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
 * A name that has gone -- a deleted cycle or project, say -- reads as "a
 * deleted cycle" rather than as an id nobody can place.
 */
export function describeEvent(event: IssueEventRead): EventSentence {
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

    case 'cycle': {
      const before = named(event.old_label, 'deletedCycle')
      const after = named(event.new_label, 'deletedCycle')
      if (!to) return say('cycle.removed', { from: before })
      if (!from) return say('cycle.added', { to: after })
      return say('cycle.moved', { from: before, to: after })
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
      const elsewhere = i18n.t('issues:history.anotherTeam')
      return say('team', { from: from ?? elsewhere, to: to ?? elsewhere })
    }

    default:
      return say('other')
  }
}

/** Who did it: a person, or -- for a rule -- "Automation". */
export function actorName(event: IssueEventRead): string {
  return event.actor?.full_name ?? i18n.t('issues:history.automation')
}

/** The sentence as plain text, for a title or a test: "Maya moved this from …". */
export function eventText(event: IssueEventRead): string {
  const { key, values } = describeEvent(event)
  // The key is typed by HistoryKey; i18next's per-key check of the values
  // cannot follow a key chosen at runtime, so it is shown one key's shape.
  const sentence = `issues:history.${key}` as 'issues:history.other'
  return i18n.t(sentence, { ...values, actor: actorName(event) }).replace(/<\/?actor>/g, '')
}

function category(value: string | null | undefined): string {
  return (
    CATEGORY_META[value as StatusCategory]?.label ?? i18n.t('issues:history.unknownStatus')
  )
}

function priority(value: string | null | undefined): string {
  return PRIORITY_META[value as IssuePriority]?.label ?? i18n.t('issues:history.noPriority')
}

function points(value: string | null | undefined): string {
  return i18n.t('issues:history.points', { count: Number(value) })
}

function named(
  label: string | null | undefined,
  gone: 'formerMember' | 'deletedCycle' | 'deletedProject',
): string {
  return label ?? i18n.t(`issues:history.${gone}`)
}

/** One row of the Activity feed: a comment or a change. */
export type ActivityItem =
  | { kind: 'comment'; at: string; comment: CommentRead }
  | { kind: 'event'; at: string; event: IssueEventRead }

/**
 * Comments and changes in one stream, oldest first -- the order the thread
 * already reads in. On a tie the change comes first: a comment is usually
 * about the change made just before it.
 */
export function interleave(comments: CommentRead[], events: IssueEventRead[]): ActivityItem[] {
  const items: ActivityItem[] = [
    ...events.map((event) => ({ kind: 'event' as const, at: event.created_at, event })),
    ...comments.map((comment) => ({ kind: 'comment' as const, at: comment.created_at, comment })),
  ]
  const time = (item: ActivityItem) => parseServerDate(item.at).getTime()
  // A stable sort, so equal timestamps keep events ahead of comments.
  return items.sort((a, b) => time(a) - time(b))
}
