/**
 * Whether choosing a template (#97) would throw away something the user wrote.
 *
 * Nothing typed yet, or the description is exactly the template chosen last,
 * untouched: swapping it loses nothing, so no question is asked. Anything else
 * is somebody's words, and replacing those gets a confirmation first.
 */
export function replacingLosesWork(description: string, lastApplied: string | null): boolean {
  return description.trim() !== '' && description !== lastApplied
}
