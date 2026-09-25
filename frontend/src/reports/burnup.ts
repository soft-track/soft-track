import type { ProjectBurnupPoint } from '@/api/generated/models'

/**
 * Whether a points chart has to say it is a floor (#64), and what to say.
 *
 * Unestimated issues are counted rather than summed in as zero -- #17 kept
 * null meaning "not sized yet" precisely so this could be told apart from a
 * genuinely small epic. Null when every issue in scope is sized.
 */
export function unestimatedNote(point: ProjectBurnupPoint | undefined): string | null {
  const count = point?.unestimated_issues ?? 0
  if (count === 0) return null
  return count === 1
    ? '1 issue in scope has no estimate, so the points scope is a floor, not the size of the project.'
    : `${count} issues in scope have no estimate, so the points scope is a floor, not the size of the project.`
}
