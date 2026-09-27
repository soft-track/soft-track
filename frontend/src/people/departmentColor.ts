/**
 * A department's colour, from its id (#123).
 *
 * Derived rather than stored: a department is a name an admin types, and a
 * colour picker would be one more thing to fill in for something that only
 * has to tell two chips apart. From the id rather than the name, so renaming
 * a department does not repaint it. The avatar palette, in the same order.
 */
const COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#22c55e']

export function departmentColor(id: number): string {
  return COLORS[Math.abs(id - 1) % COLORS.length]
}
