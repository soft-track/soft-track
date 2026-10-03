/** Settings → Team → Members. */
export const members = {
  title: '{{team}} members',
  introAdmin:
    'Admins can invite people, change roles and remove members. Guests can see everything on the team and change nothing.',
  introMember: 'Only admins of this team can change who is in it.',
  invite: {
    emailLabel: 'Invite by email',
    emailPlaceholder: 'colleague@example.com',
    roleLabel: 'Invited role',
    send: 'Send invite',
    sending: 'Inviting…',
    emailIt: 'Email the invitation to them',
    // Somebody from outside the organisation (#243).
    outside: 'This person is outside the organisation',
    outsideHint:
      'A guest who sees only the epics chosen here. No directory, no team of their own, no expense claims. Marked External wherever their name appears.',
  },
  // What somebody from outside may see (#243).
  epics: {
    label: 'Epics they can see',
    add: 'Add an epic',
    remove: 'Remove {{name}}',
    none: 'No epic chosen means no tickets.',
  },
  scope: {
    only: '{{names}} only',
    nothing: 'No epics, so no tickets',
    change: 'Change epics',
    done: 'Done',
  },
  lastInvite: {
    emailed:
      'Invitation emailed to <strong>{{email}}</strong>. The link is here too, if you would rather send it yourself.',
    ready:
      'Invitation ready for <strong>{{email}}</strong>. Copy this link and send it however your team already talks.',
    readyNoEmail:
      'Invitation ready for <strong>{{email}}</strong>. This instance does not send email — copy this link and send it however your team already talks.',
  },
  copyLink: 'Copy link',
  list: {
    heading: 'Members',
    headingCount: 'Members · {{total}}',
    loading: 'Loading members…',
    emailJoined: '{{email}} · joined {{when}}',
    joined: 'joined {{when}}',
    roleFor: 'Role for {{name}}',
    leave: 'Leave',
  },
  pending: {
    heading: 'Pending invitations',
    empty: 'Nobody is waiting on an invitation to this team.',
    invitedBy: 'Invited by {{name}} · expires {{when}}',
    sentTo: 'Sent to {{email}} {{when}}',
    resend: 'Resend',
    revoke: 'Revoke',
  },
  confirm: {
    revoke: 'Revoke the invitation to {{email}}?',
  },
  // Asked before somebody stops being able to hold the team's tickets (#316):
  // removed, leaving, or made a guest. Done and cancelled tickets keep their
  // assignee, so only open ones are counted.
  handover: {
    title: {
      remove: 'Remove {{name}} from {{team}}?',
      leave: 'Leave {{team}}?',
      guest: 'Make {{name}} a guest?',
    },
    intro: {
      remove: 'They lose access to its tickets.',
      leave: 'You will lose access to its tickets.',
      guest: 'A guest can read {{team}} but not change it, or hold its tickets.',
    },
    counting: 'Counting their open tickets…',
    holds_one:
      '{{name}} has <strong>{{count}} open ticket</strong> on this team. It stays on the board either way.',
    holds_other:
      '{{name}} has <strong>{{count}} open tickets</strong> on this team. They stay on the board either way.',
    youHold_one:
      'You have <strong>{{count}} open ticket</strong> on this team. It stays on the board either way.',
    youHold_other:
      'You have <strong>{{count}} open tickets</strong> on this team. They stay on the board either way.',
    legend_one: 'What happens to the open ticket',
    legend_other: 'What happens to the open tickets',
    unassign_one: 'Leave it unassigned',
    unassign_other: 'Leave them unassigned',
    reassign_one: 'Give it to somebody on the team',
    reassign_other: 'Give them to somebody on the team',
    choose: 'Choose a person',
    more_one: 'and {{count}} more',
    more_other: 'and {{count}} more',
    confirm: {
      remove: 'Remove member',
      leave: 'Leave team',
      guest: 'Make guest',
    },
    failed: {
      remove: 'Could not remove that member.',
      leave: 'Could not leave the team.',
      guest: 'Could not change that role.',
    },
  },
  errors: {
    invite: 'Could not send that invitation.',
    clipboard: 'Could not reach the clipboard. The link is {{link}}',
    role: 'Could not change that role.',
    revoke: 'Could not revoke that invitation.',
    resend: 'Could not resend that invitation.',
    epics: 'Could not change their epics.',
  },
} as const
