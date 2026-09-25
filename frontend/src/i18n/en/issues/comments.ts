/** Issue panel → Activity: the comment thread, the composer, and reactions on a comment (#96). */
export const comments = {
  title: 'Activity',
  empty: 'No comments yet. Start the conversation below.',
  emptyReadOnly: 'No comments yet.',
  guest: 'You are a guest on this team, so you can follow this issue but not comment on it.',
  placeholder: 'Leave a comment…',
  // The two keys are drawn in code (⌘ ↵); only their places are the sentence's.
  toSend: '<mod /><enter /> to send',
  send: 'Send',
  sending: 'Sending…',
  automation: 'Automation',
  automationTitle: 'Posted by an automation rule',
  // Editing and deleting a comment (#93).
  actions: 'Comment actions',
  more: 'More actions on this comment',
  delete: 'Delete…',
  edited: '(edited)',
  // A date-fns pattern for the "(edited)" tooltip: "25 Sep 2026, 14:03".
  editedPattern: 'd MMM yyyy, HH:mm',
  editedAt: 'Edited {{when}}',
  editing: 'Edit comment',
  // ⌘ and ↵ are drawn in code; Esc is a word, so it is the sentence's.
  toSave: '<mod /><enter /> to save · <esc>Esc</esc> to cancel',
  confirmDelete: 'Delete this comment? This cannot be undone.',
  confirmDeleteWithFiles_one: 'Delete this comment and its attached file? This cannot be undone.',
  confirmDeleteWithFiles_other:
    'Delete this comment and its {{count}} attached files? This cannot be undone.',
  saveFailed: 'Could not save your edit.',
  deleteFailed: 'Could not delete that comment.',
  reactions: {
    name: {
      thumbs_up: 'thumbs up',
      thumbs_down: 'thumbs down',
      laugh: 'laugh',
      hooray: 'hooray',
      confused: 'confused',
      heart: 'heart',
      rocket: 'rocket',
      eyes: 'eyes',
    },
    add: 'Add a reaction',
    group: 'Reactions',
    reactWith: 'React with {{name}}',
    chipAdd_one: '{{glyph}} {{count}} reaction, press to add yours',
    chipAdd_other: '{{glyph}} {{count}} reactions, press to add yours',
    chipRemove_one: '{{glyph}} {{count}} reaction, press to remove yours',
    chipRemove_other: '{{glyph}} {{count}} reactions, press to remove yours',
    you: 'You',
    // `names` is a list already joined for the language: "You, Maya and Sam".
    whoReacted_one: '{{names}} reacted with {{name}}',
    whoReacted_other: '{{names}} reacted with {{name}}',
    // A guest's chip, read out whole since there is nothing to press.
    guestChip: '{{glyph}} {{total}}: {{who}}',
  },
} as const
