import { parseServerDate } from '@/api/dates'
import type {
  CommentRead,
  IssueEventRead,
  IssuePriority,
  StatusCategory,
} from '@/api/generated/models'
import { shortDue } from '@/issues/dueDate'
import { CATEGORY_META, PRIORITY_META } from '@/issues/issueMeta'

/**
 * What an event did, as the second half of a sentence whose subject is who
 * did it: "Maya" + "moved this from Started to Done" (#81).
 *
 * Statuses read as their *category*, because that is what the history keeps
 * -- see `_status_category` in backend/lib_softtrack/history.py. It is also
 * why a move between two columns of the same category never appears here: no
 * row was written for it.
 *
 * A name that has gone -- a deleted cycle or project, say -- reads as "a
 * deleted cycle" rather than as an id nobody can place.
 */
export function describeEvent(event: IssueEventRead): string {
  const { old_value: from, new_value: to } = event

  switch (event.field) {
    case 'status':
      return `moved this from ${category(from)} to ${category(to)}`

    case 'priority':
      if (!to || to === 'no_priority') return `removed the priority (was ${priority(from)})`
      if (!from || from === 'no_priority') return `set the priority to ${priority(to)}`
      return `changed the priority from ${priority(from)} to ${priority(to)}`

    case 'estimate':
      if (!to) return `cleared the estimate (was ${points(from)})`
      if (!from) return `estimated this at ${points(to)}`
      return `changed the estimate from ${points(from)} to ${points(to)}`

    case 'assignee': {
      const before = named(event.old_label, 'a former member')
      const after = named(event.new_label, 'a former member')
      if (!to) return `unassigned ${before}`
      if (!from) return `assigned this to ${after}`
      return `reassigned this from ${before} to ${after}`
    }

    case 'cycle': {
      const before = named(event.old_label, 'a deleted cycle')
      const after = named(event.new_label, 'a deleted cycle')
      if (!to) return `moved this out of ${before}, back to the backlog`
      if (!from) return `added this to ${after}`
      return `moved this from ${before} to ${after}`
    }

    case 'due_date':
      if (!to) return `removed the due date (was ${shortDue(from ?? '')})`
      if (!from) return `set the due date to ${shortDue(to)}`
      return `moved the due date from ${shortDue(from)} to ${shortDue(to)}`

    case 'project': {
      const before = named(event.old_label, 'a deleted project')
      const after = named(event.new_label, 'a deleted project')
      if (!to) return `removed this from ${before}`
      if (!from) return `added this to ${after}`
      return `moved this from ${before} to ${after}`
    }

    case 'team':
      // Keys, not team names: ENG-42 becoming OPS-17 is the fact anybody
      // holding the old link needs (#98).
      return `moved this from ${from ?? 'another team'} to ${to ?? 'another team'}`

    default:
      return 'changed this'
  }
}

function category(value: string | null | undefined): string {
  return CATEGORY_META[value as StatusCategory]?.label ?? 'an unknown status'
}

function priority(value: string | null | undefined): string {
  return PRIORITY_META[value as IssuePriority]?.label ?? 'none'
}

function points(value: string | null | undefined): string {
  return value === '1' ? '1 point' : `${value} points`
}

function named(label: string | null | undefined, gone: string): string {
  return label ?? gone
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
