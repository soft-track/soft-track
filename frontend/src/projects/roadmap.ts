import { parseISO } from 'date-fns'

import type { ProjectRead, ReleaseRead } from '@/api/generated/models'
import { i18n } from '@/i18n'
import { formatDate } from '@/i18n/format'

/** One month of the roadmap, or the projects that have no date at all. */
export type RoadmapSection = {
  /** `2026-11`, or `undated`. Stable, for React keys and tests. */
  key: string
  title: string
  isCurrentMonth: boolean
  projects: ProjectRead[]
  /** The releases on a day in this month (#272), soonest first. */
  releases: ReleaseRead[]
}

/**
 * The day a release is marked on (#272): the day it shipped, or the day it
 * is for. None for one with neither, or one that was put away.
 */
export function releaseDay(release: ReleaseRead): string | null {
  if (release.state === 'archived') return null
  return release.released_on ?? release.target_date ?? null
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
 *
 * Each release is marked in the month of its day (#272) -- the day it
 * shipped, or the day it is for -- so a month can hold releases and no
 * epics. A release with no day is not marked: it has no place on a calendar.
 */
export function roadmapSections(
  projects: ProjectRead[],
  today: string,
  releases: readonly ReleaseRead[] = [],
): RoadmapSection[] {
  const live = projects.filter((project) => !project.archived)
  const currentMonth = today.slice(0, 7)

  const byMonth = new Map<string, ProjectRead[]>()
  for (const project of live) {
    if (!project.target_date) continue
    const month = project.target_date.slice(0, 7)
    byMonth.set(month, [...(byMonth.get(month) ?? []), project])
  }
  const releasesByMonth = new Map<string, ReleaseRead[]>()
  for (const release of releases) {
    const day = releaseDay(release)
    if (!day) continue
    const month = day.slice(0, 7)
    releasesByMonth.set(month, [...(releasesByMonth.get(month) ?? []), release])
    if (!byMonth.has(month)) byMonth.set(month, [])
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
    releases: (releasesByMonth.get(month) ?? []).sort(
      (a, b) => releaseDay(a)!.localeCompare(releaseDay(b)!) || a.name.localeCompare(b.name),
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
      releases: [],
    })
  }
  return sections
}
