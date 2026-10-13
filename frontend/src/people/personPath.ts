/** Where somebody's profile lives (#126): `/people/<username>`. */
export function personPath(person: { username: string }): string {
  return `/people/${encodeURIComponent(person.username)}`
}
