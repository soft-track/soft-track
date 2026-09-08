/**
 * `@` mentions of team members.
 *
 * The handle is the user's own `username` column, so a mention keeps pointing
 * at the same person after they change their email address -- which the old
 * email-derived handle could not promise. Usernames are unique instance-wide
 * and validated against the same character class as MENTION_PATTERN, so there
 * is no collision case left to fall back from.
 *
 * Everything that depends on the shape of a handle still lives in this file.
 */

export type Mentionable = {
  id: number
  full_name: string
  email: string
  username: string
}

/** A handle for each person. Unique by construction: usernames are unique. */
export function mentionHandles(people: Mentionable[]): Map<number, string> {
  return new Map(people.map((person) => [person.id, person.username.toLowerCase()]))
}

/** Reverse of `mentionHandles`, for the renderer. */
export function peopleByHandle(people: Mentionable[]): Map<string, Mentionable> {
  return new Map(people.map((person) => [person.username.toLowerCase(), person]))
}

/**
 * Matches `@handle` where a mention can plausibly start.
 *
 * The leading boundary stops `user@example.com` in prose from being read as a
 * mention of `@example.com`.
 */
export const MENTION_PATTERN = /(^|[^\w@/])@([a-z0-9][a-z0-9._-]*)/gi

/** People whose handle or name matches what has been typed after the `@`. */
export function matchMentions(people: Mentionable[], query: string, limit = 6): Mentionable[] {
  const needle = query.toLowerCase()
  return people
    .filter((person) => {
      if (!needle) return true
      return (
        person.username.toLowerCase().includes(needle) ||
        person.full_name.toLowerCase().includes(needle)
      )
    })
    .slice(0, limit)
}
