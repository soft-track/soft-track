/** Board → the quick peek (#113): a read-only preview of a card, on Space or a resting mouse. */
export const peek = {
  // The preview's own name, for assistive tech.
  label: 'Preview of {{identifier}}',
  noDescription: 'No description.',
  // Read out when Space opens a preview, since focus stays on the card.
  announce: 'Preview of {{identifier}}, {{title}}. {{status}}. Enter opens it, Escape closes it.',
  // ↵ is drawn in code; Esc is a word, so it is the sentence's.
  hint: '<enter /> open · <esc>Esc</esc> close',
} as const
