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
    leave: 'Leave {{team}}? You will lose access to its issues.',
    remove: 'Remove {{name}} from {{team}}? Their issues stay assigned to them.',
    revoke: 'Revoke the invitation to {{email}}?',
  },
  errors: {
    invite: 'Could not send that invitation.',
    clipboard: 'Could not reach the clipboard. The link is {{link}}',
    role: 'Could not change that role.',
    remove: 'Could not remove that member.',
    revoke: 'Could not revoke that invitation.',
    resend: 'Could not resend that invitation.',
  },
} as const
