import { i18n } from '@/i18n'

/**
 * The colours a label can be given (#321): ten, the palette's order is the
 * order they are offered in. Named, so a swatch reads as "Teal" rather than
 * a hex code to someone who cannot see it. The last is the one the API gives
 * a label nobody chose a colour for.
 */
export const LABEL_COLOURS = [
  labelColour('red', '#ef4444'),
  labelColour('orange', '#f97316'),
  labelColour('amber', '#f59e0b'),
  labelColour('green', '#22c55e'),
  labelColour('teal', '#14b8a6'),
  labelColour('sky', '#0ea5e9'),
  labelColour('indigo', '#6366f1'),
  labelColour('violet', '#8b5cf6'),
  labelColour('pink', '#ec4899'),
  labelColour('slate', '#94a3b8'),
]

type LabelColourId =
  | 'red'
  | 'orange'
  | 'amber'
  | 'green'
  | 'teal'
  | 'sky'
  | 'indigo'
  | 'violet'
  | 'pink'
  | 'slate'

function labelColour(id: LabelColourId, value: string) {
  return {
    id,
    value,
    get label() {
      return i18n.t(`team:labels.colours.${id}`)
    },
  }
}

/** The palette's name for a colour, or undefined for one of its own. */
export function labelColourName(value: string): string | undefined {
  return LABEL_COLOURS.find((colour) => colour.value === value.toLowerCase())?.label
}
