/**
 * `@` mentions of team members.
 *
 * Handles are derived from the email's local part rather than stored, because
 * users have no username column yet. That has one consequence worth knowing:
 * a mention is resolved against the team roster at render time, so it follows
 * whoever holds the address today rather than whoever was meant when it was
 * written. Stable mentions need a real `username` on User -- that is a schema
 * change and its own issue. Everything that depends on the shape of a handle
 * lives in this file, so swapping the derivation is a one-file change.
 */

export type Mentionable = {
  id: number
  full_name: string
  email: string
}

const HANDLE_UNSAFE = /[^a-z0-9._-]+/g

function localPart(email: string): string {
  return email.split('@')[0].toLowerCase().replace(HANDLE_UNSAFE, '-')
}

/**
 * A handle for each person, unique within the list.
 *
 * Two people can share a local part across domains (`sam@a.com`,
 * `sam@b.com`). Numbering them would be unstable -- the suffix would depend on
 * roster order -- so everyone in a colliding group falls back to their full
 * address, which is unique by definition.
 */
export function mentionHandles(people: Mentionable[]): Map<number, string> {
  const byLocal = new Map<string, Mentionable[]>()
  for (const person of people) {
    const local = localPart(person.email)
    byLocal.set(local, [...(byLocal.get(local) ?? []), person])
  }

  const handles = new Map<number, string>()
  for (const [local, group] of byLocal) {
    for (const person of group) {
      handles.set(person.id, group.length === 1 ? local : person.email.toLowerCase())
    }
  }
  return handles
}

/** Reverse of `mentionHandles`, for the renderer. */
export function peopleByHandle(people: Mentionable[]): Map<string, Mentionable> {
  const handles = mentionHandles(people)
  const byHandle = new Map<string, Mentionable>()
  for (const person of people) {
    const handle = handles.get(person.id)
    if (handle) byHandle.set(handle, person)
  }
  return byHandle
}

/**
 * Matches `@handle` where a mention can plausibly start.
 *
 * The leading boundary stops `user@example.com` in prose from being read as a
 * mention of `@example.com`, and the alternation lets a handle be a full
 * address for the collision case above.
 */
export const MENTION_PATTERN =
  /(^|[^\w@/])@([a-z0-9][a-z0-9._-]*(?:@[a-z0-9-]+(?:\.[a-z0-9-]+)+)?)/gi

/** People whose handle or name matches what has been typed after the `@`. */
export function matchMentions(people: Mentionable[], query: string, limit = 6): Mentionable[] {
  const handles = mentionHandles(people)
  const needle = query.toLowerCase()
  return people
    .filter((person) => {
      if (!needle) return true
      return (
        (handles.get(person.id) ?? '').includes(needle) ||
        person.full_name.toLowerCase().includes(needle)
      )
    })
    .slice(0, limit)
}
