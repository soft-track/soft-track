/** The preview dialog for a PDF or a text file (#101). */
export const preview = {
  download: 'Download',
  closeHint: 'Close (Esc)',
  loading: 'Loading {{filename}}…',
  failed: 'This file could not be shown here.',
  downloadInstead: 'Download it instead',
  // Above a text file cut at the first megabyte; <download> is a button.
  truncated:
    'Showing the first {{shown}} of {{total}} — truncated. <download>Download for the rest</download>.',
  contents: 'Contents of {{filename}}',
} as const
