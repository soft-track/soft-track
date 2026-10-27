import { i18n } from '@/i18n'

/**
 * The three sections a new bug's description offers (#273): steps to
 * reproduce, expected and actual. Headings in the markdown rather than
 * fields of their own, so the description reads the same in an email, an
 * export or anywhere else it is shown.
 */
export function bugSections(): string {
  const heading = (key: 'steps' | 'expected' | 'actual') =>
    `## ${i18n.t(`tickets:newTicket.bug.${key}`)}`
  return `${heading('steps')}\n\n1. \n\n${heading('expected')}\n\n\n\n${heading('actual')}\n\n`
}

/**
 * The description a ticket should start with after its type changes from
 * one to the other: the sections when it becomes a bug with nothing written
 * yet, and nothing again when it stops being one with the sections still
 * untouched. Anything somebody wrote is theirs, and is left as it is.
 */
export function descriptionForType(description: string, isBug: boolean): string {
  const sections = bugSections()
  if (isBug && description.trim() === '') return sections
  if (!isBug && description === sections) return ''
  return description
}

/**
 * A bug's description from a failed test (#275): the case's steps, up to the
 * one that failed, as steps to reproduce; what that step should have done as
 * expected; and the note as actual.
 */
export function bugSectionsFrom(
  steps: ReadonlyArray<{ action: string; expected?: string }>,
  failedStep?: number | null,
  note?: string | null,
): string {
  const heading = (key: 'steps' | 'expected' | 'actual') =>
    `## ${i18n.t(`tickets:newTicket.bug.${key}`)}`
  const upTo = failedStep && failedStep <= steps.length ? failedStep : steps.length
  const taken = steps.slice(0, upTo)
  const reproduce = taken.length
    ? taken.map((step, index) => `${index + 1}. ${step.action}`).join('\n')
    : '1. '
  const expected = taken.length ? (taken[taken.length - 1].expected ?? '') : ''
  return [
    heading('steps'),
    '',
    reproduce,
    '',
    heading('expected'),
    '',
    expected,
    '',
    heading('actual'),
    '',
    note ?? '',
    '',
  ].join('\n')
}
