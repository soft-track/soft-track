/**
 * Chart colours, taken from the app's existing tokens rather than invented.
 *
 * Two of these choices were made by running the palette validator, not by eye:
 *
 * 1. The board's status palette FAILS as a categorical palette for a stacked
 *    chart -- `backlog` and `todo` are both near-grey and only ΔE 14.4 apart in
 *    normal vision, and they sit adjacent in the stack. It is fine as dots on a
 *    board, where every dot has a text label beside it; it is not fine as six
 *    touching bands. So the cumulative flow diagram does not use it.
 *
 * 2. A CFD's bands are *ordered stages*, not unrelated categories, so they use a
 *    sequential ramp instead: light at the backlog, darkest at done. Lightness
 *    carries the progression, which sidesteps the categorical problem entirely
 *    and says something true about the data. Cancelled is deliberately not on
 *    that ramp -- it is an exit from the workflow, not a step along it -- so it
 *    is neutral.
 *
 * The two-series pairs below both pass every check (ΔE 44 and ΔE 34 in normal
 * vision, and no worse than 26 under simulated CVD).
 *
 * Grid and axis inks are mixed from the neutral ramp so they follow the theme:
 * a fixed light grey would vanish on the dark canvas.
 */

/** Workflow stages, bottom to top, light to dark. */
/**
 * The cumulative flow bands, by status *category*.
 *
 * Not by the team's own columns: this chart is drawn from history, and the
 * history records categories precisely so that a picture of last month keeps
 * meaning something after somebody renames or deletes a column. See
 * `_status_category` in backend/lib_softtrack/history.py.
 */
export const FLOW_RAMP: Record<string, string> = {
  backlog: 'var(--color-brand-200)',
  unstarted: 'var(--color-brand-300)',
  started: 'var(--color-brand-500)',
  done: 'var(--color-brand-700)',
  // Off the ramp on purpose: cancelled work left the workflow, it did not
  // advance through it.
  cancelled: 'var(--color-neutral-400)',
}

export const FLOW_ORDER = ['backlog', 'unstarted', 'started', 'done', 'cancelled'] as const

/** Measure vs reference, and the two-series pairs. */
export const INK = {
  measure: 'var(--color-brand-600)',
  reference: 'var(--color-neutral-300)',
  /** Validated against `measure`: ΔE 44 normal, 39 protan. */
  contrastSeries: 'var(--color-priority-medium)',
  /** Validated against `measure`: ΔE 34 normal, 27 deutan. */
  resolved: 'var(--color-status-done)',
  grid: 'color-mix(in oklab, var(--color-neutral-900) 9%, transparent)',
  axis: 'var(--color-neutral-400)',
  surface: 'transparent',
} as const

/**
 * One ink per currency, for the finance reports (#135), in the order the
 * currencies are listed: by code.
 *
 * The first three are `INK`'s own measure and its two validated partners,
 * and clear CIEDE2000 16 against each other in normal vision and under
 * simulated protan, deutan and tritan vision. The fourth, brand-300, clears
 * 23 against all three, and is lighter, so it is never the first a chart
 * draws. A fifth currency and on share the axis ink: identity is never
 * colour alone, and every series is labelled where it ends.
 *
 * Deliberately not here: the danger red. Status-done green and danger red
 * are only ΔE 12.5 apart for a deutan reader, so over budget is said with a
 * red bar *and* its position past the tick *and* the word -- the spend
 * chart draws every bar in `INK.measure` and never needs a currency ink.
 */
export const CURRENCY_INKS = [
  INK.measure,
  INK.contrastSeries,
  INK.resolved,
  'var(--color-brand-300)',
] as const

export function currencyInk(index: number): string {
  return CURRENCY_INKS[index] ?? INK.axis
}

/**
 * The line a count is drawn with beside money: the text colour, which
 * follows the theme -- the fixed near-black ink would all but vanish on the
 * dark canvas.
 */
export const COUNT_INK = 'var(--color-neutral-900)'
