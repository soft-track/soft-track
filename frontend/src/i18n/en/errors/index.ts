import type { ErrorCode } from '@/api/generated/models'

/**
 * The frontend's own words for errors the API reports by code (#86, #106).
 *
 * Keyed by `ErrorCode`, so a code renamed or removed on the server fails the
 * typecheck here. Deliberately partial: a code with no entry falls back to
 * the server's `detail` -- see `errorDetail` in src/api/errors.ts.
 */
export const errors = {
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
  team_read_only: 'You are a guest on this team: you can see its work but not change it.',
  not_site_admin: 'Only a site administrator can do that.',
  last_team_admin: 'A team needs at least one admin. Make someone else an admin first.',
  last_site_admin: 'This instance needs at least one active site administrator.',
  cannot_deactivate_self: 'You cannot deactivate your own account.',
  cannot_demote_self: 'You cannot remove your own site admin access.',

  // Whose comment it is (#93).
  not_your_comment:
    'Only the person who wrote a comment can edit it. Its author or a team admin can delete it.',
} as const satisfies Partial<Record<ErrorCode, string>>
