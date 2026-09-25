/** The markdown editor: its Write / Preview tabs, the hint line, Attach and the mention menu. */
export const editor = {
  mode: 'Editor mode',
  write: 'Write',
  preview: 'Preview',
  // <handle> is the "@" set as an identifier.
  hint: 'Markdown supported · <handle>@</handle> to mention',
  hintWithFiles: 'Markdown · <handle>@</handle> to mention · paste or drop a file',
  attach: 'Attach',
  uploading: 'Uploading…',
  people: 'Team members',
  emptyPreview: 'Nothing to preview yet.',
} as const
