import { parseISO } from 'date-fns'

import type { ProjectRead } from '@/api/generated/models'
import { i18n } from '@/i18n'
import { formatDate } from '@/i18n/format'

/** One month of the roadmap, or the projects that have no date at all. */
export type RoadmapSection = {
  /** `2026-11`, or `undated`. Stable, for React keys and tests. */
  key: string
  title: string
  isCurrentMonth: boolean
  projects: ProjectRead[]
}

/** States a project cannot be late in: it has already landed, or never will. */
const FINISHED: ReadonlyArray<ProjectRead['state']> = ['completed', 'cancelled']

/**
 * Past its target date and still open.
 *
 * Compared as `yyyy-MM-dd` strings rather than as Dates: a target is a day,
 * and parsing one into a timestamp would move it across midnight for anybody
 * west of UTC. `today` is passed in so the rule is testable.
 */
export function isOverdue(project: ProjectRead, today: string): boolean {
  return (
    project.target_date != null &&
    project.target_date < today &&
    !FINISHED.includes(project.state)
  )
}

/**
 * The team's projects by the month they are due (issue #62).
 *
 * By month rather than a zoomable timeline: an epic's date is a commitment to
 * a day, and the question the page answers -- "what lands when" -- reads
 * straight off a list of months. Months with nothing due are skipped, not
 * drawn empty.
 *
 * Archived projects are left out; they were retired from planning. Projects
 * with no target date come last, in a section of their own, so they are
 * visibly unplanned rather than silently missing.
 */
export function roadmapSections(projects: ProjectRead[], today: string): RoadmapSection[] {
  const live = projects.filter((project) => !project.archived)
  const currentMonth = today.slice(0, 7)

  const byMonth = new Map<string, ProjectRead[]>()
  for (const project of live) {
    if (!project.target_date) continue
    const month = project.target_date.slice(0, 7)
    byMonth.set(month, [...(byMonth.get(month) ?? []), project])
  }

  const sections: RoadmapSection[] = [...byMonth.keys()].sort().map((month) => ({
    key: month,
    title: formatDate(parseISO(`${month}-01`), i18n.t('projects:roadmap.monthPattern')),
    isCurrentMonth: month === currentMonth,
    projects: byMonth
      .get(month)!
      .sort(
        (a, b) =>
          a.target_date!.localeCompare(b.target_date!) || a.name.localeCompare(b.name),
      ),
  }))

  const undated = live
    .filter((project) => !project.target_date)
    .sort((a, b) => a.name.localeCompare(b.name))
  if (undated.length > 0) {
    sections.push({
      key: 'undated',
      title: i18n.t('projects:roadmap.undatedSection'),
      isCurrentMonth: false,
      projects: undated,
    })
  }
  return sections
}
