/**
 * Parse a timestamp the API returned.
 *
 * The backend stores datetimes without a timezone (`sa.DateTime()`, not
 * `timezone=True`) and Pydantic serialises them with no offset, so
 * `2026-09-08T08:35:47` arrives with nothing to say it is UTC. `new Date()`
 * reads a bare timestamp as *local* time, which puts every "x ago" out by the
 * viewer's offset -- five hours, in the timezone this was found in.
 *
 * Appending `Z` when there is no zone says what the server meant. A value that
 * already carries one (an offset, or a trailing Z) is left alone.
 */
export function parseServerDate(value: string): Date {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
  return new Date(hasZone ? value : `${value}Z`)
}


/** Format cycle boundaries as calendar days in the server's timezone.
 *
 * Cycle boundaries represent whole UTC days, even though the API serialises
 * them as instants. Formatting with an explicit timezone prevents a viewer's
 * local offset from moving the displayed day across midnight.
 */
export function formatCycleRange(
  startsAt: string,
  endsAt: string,
  timeZone = 'UTC',
): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone,
  })
  return `${formatter.format(parseServerDate(startsAt))} – ${formatter.format(parseServerDate(endsAt))}`
}
