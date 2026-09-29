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
  not_finance_admin:
    'Only a finance admin can do that. A site admin can grant finance access from Administration → Users.',
  last_team_admin: 'A team needs at least one admin. Make someone else an admin first.',
  last_site_admin: 'This instance needs at least one active site administrator.',
  cannot_deactivate_self: 'You cannot deactivate your own account.',
  cannot_demote_self: 'You cannot remove your own site admin access.',

  // Whose comment it is (#93).
  not_your_comment:
    'Only the person who wrote a comment can edit it. Its author or a team admin can delete it.',

  // Tickets and epics (#211). The interface's own words for them: the API
  // still calls an epic a project, and several of these say more than its
  // `detail` does.
  ticket_not_found:
    'That ticket could not be found. It may have been deleted, or moved to another team.',
  tickets_not_found: 'Some of those tickets are no longer on this team. Refresh and try again.',
  parent_not_found: 'That parent ticket could not be found.',
  project_not_found: 'That epic could not be found. It may have been deleted.',
  not_on_this_team:
    'Something you picked is not on this team. It may have been deleted since the page loaded; refresh and try again.',
  import_empty: 'That file has no Jira issues in it.',
  link_to_self: 'A ticket cannot be linked to itself.',
  link_exists: 'These tickets are already linked.',
  link_contradicts: 'That would contradict a link these tickets already have.',
  link_not_found: 'That link is no longer on this ticket.',
  rank_neighbour_is_self: 'A ticket cannot be placed next to itself.',
  parent_is_self: 'A ticket cannot be its own parent.',
  parent_other_team: 'A sub-ticket must be on the same team as its parent.',
  parent_is_subticket:
    'That ticket is already a sub-ticket. Sub-tickets are one level deep, so it cannot also be a parent.',
  ticket_has_subtickets:
    'This ticket has sub-tickets of its own, so it cannot become a sub-ticket. Move or detach its children first.',
  transfer_same_team: 'The ticket is already on that team.',
  team_has_no_statuses: 'This team has no statuses to put a ticket in.',
  last_status: 'A team needs at least one status; there would be nowhere to put its tickets.',
  status_move_to_same: 'Move the tickets to a different status.',
} as const satisfies Partial<Record<ErrorCode, string>>
