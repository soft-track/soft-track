import { i18n } from '@/i18n'

/**
 * Durations as people type them (#102): "2h 30m", "45m", "1h15m", "1.5h",
 * "2:30", or a bare number of minutes. Minutes out, or null for anything
 * that is not a duration -- the form says so rather than guessing.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase()
  if (!text) return null

  const clock = /^(\d+):([0-5]\d)$/.exec(text)
  if (clock) return positive(Number(clock[1]) * 60 + Number(clock[2]))

  if (/^\d+$/.test(text)) return positive(Number(text))

  const parts = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/.exec(text)
  if (!parts || (parts[1] === undefined && parts[2] === undefined)) return null
  const hours = parts[1] ? Number(parts[1]) : 0
  const minutes = parts[2] ? Number(parts[2]) : 0
  return positive(Math.round(hours * 60 + minutes))
}

function positive(minutes: number): number | null {
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null
}

/**
 * "2h 30m", "45m", "3h" -- the way it was most likely typed. The units are
 * the catalog's (#106); what `parseDuration` accepts is still English, since
 * it reads what people type rather than what the page says.
 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return i18n.t('issues:meta.duration.minutes', { minutes: rest })
  return rest === 0
    ? i18n.t('issues:meta.duration.hours', { hours })
    : i18n.t('issues:meta.duration.both', { hours, minutes: rest })
}
