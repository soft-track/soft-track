/** A ticket's own page (#112): its header, and what it says when the ticket is not there. */
export const page = {
  breadcrumb: 'Breadcrumb',
  // The team crumb. On a phone it is the back button, so it says where it goes.
  backTo: 'Back to {{team}}',
  parentTitle: 'Parent ticket: {{title}}',
  copyLink: 'Copy link',
  copyLinkHint: 'Copy a link to this ticket',
  // The link is the address of the page itself, which is what makes this fallback enough.
  clipboardFailed: 'Could not reach the clipboard. The address of this page is the link.',
  // The browser tab, so a row of ticket tabs can be told apart.
  documentTitle: '{{identifier}} {{title}} · SoftTrack',
  loading: 'Loading the ticket…',
  loadFailed: 'Could not load this ticket.',
  notFound: 'No such ticket',
  notFoundBody: '{{identifier}} does not exist, or it was moved to another team.',
  // Where "not found" sends you when there is no team to go back to.
  home: 'Go to your teams',
  // A link to a ticket in the trash (#323): who put it there, and until when
  // it can come back.
  deleted: '{{identifier}} was deleted',
  deletedBody:
    'By {{name}} on {{on}}. It can be restored until {{until}}, with its comments, links and attachments.',
  deletedBodyNobody:
    'On {{on}}. It can be restored until {{until}}, with its comments, links and attachments.',
  restore: 'Restore {{identifier}}',
  restoreFailed: 'Could not restore it.',
  datePattern: 'd MMM yyyy',
  untilPattern: 'd MMM',
} as const
