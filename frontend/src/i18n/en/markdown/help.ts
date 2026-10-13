/** Markdown help (#118): the popover beside Preview, for what the toolbar does not cover. */
export const help = {
  open: 'Markdown help',
  title: 'Markdown in SoftTrack',
  // Each row: what to type, then what it makes.
  rows: {
    bold: { syntax: '**bold**', meaning: 'bold' },
    italic: { syntax: '*italic*', meaning: 'italic' },
    link: { syntax: '[text](url)', meaning: 'link' },
    strikethrough: { syntax: '~~struck~~', meaning: 'strikethrough' },
    heading: { syntax: '# Heading', meaning: 'headings, up to ###' },
    task: { syntax: '- [ ] task', meaning: 'a checklist that toggles' },
    code: { syntax: '`code`', meaning: 'inline code' },
    mention: { syntax: '@name', meaning: 'mention someone' },
  },
  // Shown only where ticket keys become links; the key is the team's own.
  ticket: { syntax: '{{key}}-42', meaning: 'links a ticket' },
  note: 'No underline, fonts, sizes or colours: markdown has no way to store them, and the stored format stays markdown.',
} as const
