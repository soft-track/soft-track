import type { ErrorCode } from '@/api/generated/models'

type ApiErrorResponse = { response?: { data?: { detail?: unknown; code?: unknown } } }

/**
 * The frontend's own words for errors it knows by code (#86).
 *
 * Preferred over the server's `detail` when a code is here, so the copy the
 * user reads belongs to the UI rather than to a backend string -- and so it
 * can be translated one day without touching the API. Anything not listed
 * falls back to `detail`, which is always a readable sentence.
 *
 * Deliberately partial, and grown a group at a time: signing in first, then
 * team permissions. Wording that only restates `detail` is not worth a row.
 */
export const ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
  // Signing in and staying signed in.
  bad_credentials: 'That email and password do not match an account.',
  not_authenticated: 'Your session has ended. Sign in again to carry on.',
  account_deactivated: 'This account has been deactivated. Ask a site admin to turn it back on.',
  invite_only: 'This SoftTrack is invite-only. Ask a team admin for an invitation link.',
  email_taken: 'An account already uses that email address. Try signing in instead.',
  current_password_incorrect: 'That is not your current password.',
  reset_link_invalid:
    'This reset link is invalid or has expired. Ask for a new one below.',

  // What a team lets you do.
  not_team_member: 'You are not a member of this team.',
  not_team_admin: 'Only an admin of this team can do that.',
  not_site_admin: 'Only a site administrator can do that.',
  last_team_admin: 'A team needs at least one admin. Make someone else an admin first.',
  last_site_admin: 'This instance needs at least one active site administrator.',
  cannot_deactivate_self: 'You cannot deactivate your own account.',
  cannot_demote_self: 'You cannot remove your own site admin access.',
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
  const known = code ? ERROR_MESSAGES[code] : undefined
  if (known) return known
  const detail = (err as ApiErrorResponse)?.response?.data?.detail
  return typeof detail === 'string' && detail.length > 0 ? detail : fallback
}
