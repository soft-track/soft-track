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
