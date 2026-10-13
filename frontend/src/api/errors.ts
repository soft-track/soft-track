import type { ErrorCode } from '@/api/generated/models'
import { i18n } from '@/i18n'

type ApiErrorResponse = { response?: { data?: { detail?: unknown; code?: unknown } } }

/**
 * The frontend's own words for errors it knows by code (#86), in the catalog
 * under `errors` (#106) -- preferred over the server's `detail` when a code is
 * there, so the copy belongs to the interface and is translated with it.
 * Anything not listed falls back to `detail`, which is always a sentence.
 *
 * Deliberately partial, and grown a group at a time: signing in first, then
 * team permissions. Wording that only restates `detail` is not worth a row.
 */
export function errorMessage(code: ErrorCode): string | undefined {
  const key = `errors:${code}` as const
  return i18n.exists(key) ? i18n.t(key as 'errors:not_team_admin') : undefined
}

/** The API's error code, when the response has one. */
export function errorCode(err: unknown): ErrorCode | null {
  const code = (err as ApiErrorResponse)?.response?.data?.code
  return typeof code === 'string' ? (code as ErrorCode) : null
}

/**
 * What to tell the user about a failed request.
 *
 * The frontend's message for a known code, else the API's `detail`, else the
 * caller's fallback -- for a network failure, or a 422 whose `detail` is a
 * list of field errors rather than a sentence.
 */
export function errorDetail(err: unknown, fallback: string): string {
  const code = errorCode(err)
  const known = code ? errorMessage(code) : undefined
  if (known) return known
  const detail = (err as ApiErrorResponse)?.response?.data?.detail
  return typeof detail === 'string' && detail.length > 0 ? detail : fallback
}
